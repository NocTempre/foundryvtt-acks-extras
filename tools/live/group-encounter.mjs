/**
 * Live walk, the encounter group: docs/lib/TESTING.md "The encounter group". A
 * monster dropped on a group by the sheet's own drop, its row's Roll pressed and
 * its dialog answered, on a GM seat; the card that reaches the Judges alone; a
 * press that writes its own monster and no other; a count a hand set, a side in
 * units and a stack with no count; a body on record stops that monster's press;
 * the token's face on both seats and the Judge's own nameplate; Make Encounter
 * from the monster sheet; a family dropped on a sheet; the line a scene opens the
 * dialog on; an Observer and an Owner on a Player seat; two sheets, two rows and
 * their dialogs open at once; a row dragged to the map; and the raised type size
 * and a narrow window on every new control.
 * Machine values arrive through ./_env.mjs. A check prints shapes and invented
 * figures; every line in here is invented.
 *
 * Fixtures, kept and found again by marker (`api.fixture`): the monsters
 * `lib/encounter-lined`, `lib/encounter-units` and `lib/encounter-mute`, the
 * groups `lib/encounter-band`, `lib/encounter-second` and
 * `lib/encounter-unlinked`, the family `lib/encounter-family`, and the scene
 * `lib/encounter-scene` with the tokens the walk places on it. Each section
 * writes the shape it needs first. What the run makes that is no fixture, the
 * cards, the group Make Encounter creates, its token and the monster a family
 * generates, is tracked by id and swept in the finally. So are the bodies a drag
 * puts on the map: the sheet's Recall folds them back, so the sweep reports them
 * not found, and finds them only where the walk died first.
 */
import path from "node:path";
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, logDir, shotDir } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };

const SCOPE = "acks-extras";
const GROUP = `${SCOPE}.group`;
const TEMPLATE = `${SCOPE}.template`;
const ART = "icons/svg/skull.svg";
const LARGEST_TYPE = 18;

const side = (noun, number, unit = "") => ({ noun, number, unit });
const LINED = {
  lairChance: 40,
  dungeon: { wandering: side("knot", "1d3"), lair: side("roost", "2d3") },
  wilderness: { wandering: side("muster", "2d3+1"), lair: side("roost", "3d3") },
};
const UNITS = {
  lairChance: 40,
  dungeon: { wandering: side("", ""), lair: side("", "") },
  wilderness: { wandering: side("muster", "1d3", "knots"), lair: side("roost", "2d3") },
};
const ALL_UNITS = {
  lairChance: 40,
  dungeon: { wandering: side("", ""), lair: side("", "") },
  wilderness: { wandering: side("muster", "1d3", "knots"), lair: side("roost", "2d3", "knots") },
};
const MUTE = { lairChance: null, dungeon: { wandering: side("", ""), lair: side("", "") }, wilderness: { wandering: side("", ""), lair: side("", "") } };

const tally = { pass: 0, fail: 0 };
const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const check = (label, ok, detail) => {
  tally[ok ? "pass" : "fail"] += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const within = (n, low, high) => Number.isInteger(n) && n >= low && n <= high;
const plate = (name) => path.join(process.env.SHOTS === "1" ? shotDir() : logDir(), name);

/** Records a page's throws from before its first script, the recipe's only way to see init, setup and ready. */
const RECORDER = `(() => {
  const R = (globalThis.__geBoot = { phase: "load", phases: [], errors: [] });
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
    boot: globalThis.__geBoot ?? null,
  }),

  install: async () => {
    const H = (globalThis.__ge = globalThis.__ge ?? {});
    H.travel = await import("/modules/acks-extras/scripts/formation/travel.mjs");
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 50, every = 120 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    H.sheetOf = (id) => H.sheets?.get(id) ?? game.actors.get(id)?.sheet;
    H.sheets = new Map();
    H.dialogs = () => [...foundry.applications.instances.values()].filter((a) => a.element?.querySelector?.(".acks-lib-group-roll"));
    H.warns = [];
    const warn = ui.notifications.warn.bind(ui.notifications);
    ui.notifications.warn = (message, options) => {
      H.warns.push(String(message));
      return warn(message, options);
    };
    return { module: game.modules.get("acks-extras")?.version ?? null, isGM: game.user.isGM };
  },

  nowMs: async () => Date.now(),
  boot: async () => globalThis.__geBoot ?? null,
  warnsAfter: async (n) => globalThis.__ge.warns.slice(n),
  warnCount: async () => globalThis.__ge.warns.length,

  setLines: async ({ actorId, encounter }) => {
    const actor = game.actors.get(actorId);
    await actor.update({ [`flags.acks-extras.extras.encounter`]: encounter, img: "icons/svg/skull.svg", "prototypeToken.texture.src": "icons/svg/skull.svg" });
    return true;
  },

  /** A group back to nothing: no stack, no encounter, its token the actor's own. */
  reset: async ({ groupId }) => {
    const group = game.actors.get(groupId);
    const icon = Actor.implementation.DEFAULT_ICON;
    await group.update({
      "system.stacks": [],
      "system.noun": "",
      "system.reveal": "",
      "system.unit.category": "monster",
      img: icon,
      "prototypeToken.name": group.name,
      "prototypeToken.texture.src": icon,
    });
    return group.system.stacks.length;
  },

  grant: async ({ actorId, name, level }) => {
    const actor = game.actors.get(actorId);
    const user = game.users.find((u) => u.name === name);
    await actor.update({ ownership: { [user.id]: level } });
    return actor.ownership[user.id];
  },

  open: async ({ actorId }) => {
    const H = globalThis.__ge;
    const app = game.actors.get(actorId).sheet;
    H.sheets.delete(actorId);
    await app.render(true);
    return !!(await H.poll(() => H.root(app)?.querySelector(".acks-lib-group-body")));
  },

  /** An unlinked token's own sheet. */
  openToken: async ({ sceneId, tokenId, key }) => {
    const H = globalThis.__ge;
    const app = game.scenes.get(sceneId).tokens.get(tokenId).actor.sheet;
    H.sheets.set(key, app);
    await app.render(true);
    return !!(await H.poll(() => H.root(app)?.querySelector(".acks-lib-group-body")));
  },

  close: async ({ actorId }) => {
    const H = globalThis.__ge;
    await H.sheetOf(actorId)?.close({ force: true });
    H.sheets.delete(actorId);
    return true;
  },

  /** What this seat's open sheet offers and says. */
  view: async ({ groupId }) => {
    const H = globalThis.__ge;
    const root = H.root(H.sheetOf(groupId));
    const body = root?.querySelector(".acks-lib-group-body");
    if (!body) return null;
    const q = (s) => body.querySelector(s);
    const stacks = [...body.querySelectorAll(".acks-lib-group-stack")];
    return {
      stacks: stacks.length,
      roll: H.text(q("[data-action='rollEncounter']")) || null,
      rolls: stacks.map((s) => H.text(s.querySelector("[data-action='rollEncounter']")) || null),
      reveal: q("select[name='system.reveal']")?.value ?? null,
      reads: H.text(q(".acks-lib-group-encounter__face")) || null,
      total: H.text(q(".size-current")),
      totalTip: q(".size-current")?.dataset.tooltipText ?? "",
      noun: H.text(q(".size-noun")),
      canPlace: game.user.can("TOKEN_CREATE"),
      tips: stacks.map((s) => s.querySelector(".stack-count")?.dataset.tooltipText ?? ""),
      notes: stacks.map((s) => [...s.querySelectorAll(".stack-roll-note")].map(H.text)),
      sizeInputs: body.querySelectorAll("input[data-stack-size]").length,
      fields: body.querySelectorAll("input:not([disabled]), select:not([disabled])").length,
      purse: !!q(".acks-lib-group-purse"),
      troopType: !!q("[name='system.unit.troopType']"),
      loyalty: !!q("[name='system.unit.loyalty']"),
      category: !!q("[name='system.unit.category']"),
      morale: !!q("[name='system.unit.morale']"),
      titles: body.querySelectorAll("[title]").length,
      // A prose editor's toggle is core's, and names itself once it is open.
      unnamed: [...body.querySelectorAll("button")].filter((b) => !b.closest("prose-mirror") && !H.text(b).length && !b.getAttribute("aria-label")).length,
    };
  },

  /** A drop from the sidebar on the sheet, or on one stack, by the event a browser sends. */
  drop: async ({ groupId, actorId, stackKey }) => {
    const H = globalThis.__ge;
    const root = H.root(H.sheetOf(groupId));
    const el = stackKey ? root.querySelector(`[data-stack-key="${stackKey}"]`) : root;
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ type: "Actor", uuid: game.actors.get(actorId).uuid }));
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    await H.sleep(400);
    return true;
  },

  /** One stack's row as this seat has it. */
  row: async ({ groupId, stackKey }) => {
    const H = globalThis.__ge;
    const stack = H.root(H.sheetOf(groupId))?.querySelector(`[data-stack-key="${stackKey}"]`);
    if (!stack) return null;
    const grip = stack.querySelector(".stack-grab");
    return {
      draggable: grip.draggable,
      tip: grip.dataset.tooltip ?? null,
      art: stack.querySelector(".stack-img")?.getAttribute("src") ?? null,
      name: H.text(stack.querySelector(".stack-title")),
      detail: H.text(stack.querySelector(".stack-detail")),
      count: H.text(stack.querySelector(".stack-count")),
      deploy: !!stack.querySelector("[data-action='deploy']"),
      fields: [...stack.querySelectorAll(".stack-head input")].map((input) => input.getAttribute("aria-label")),
    };
  },

  /**
   * A row dragged to the map by the events a browser sends: the grip's dragstart
   * writes the transfer and the board's drop reads it. `forged` sends the drop
   * alone, which is what a seat with no grip can still do. `at` is scene pixels.
   */
  dragRow: async ({ groupId, stackKey, at, shift = false, alt = false, forged = false }) => {
    const H = globalThis.__ge;
    const { sceneX, sceneY } = canvas.dimensions;
    const point = { x: sceneX + at.x, y: sceneY + at.y };
    const client = canvas.clientCoordinatesFromCanvas(point);
    const dataTransfer = new DataTransfer();
    if (forged) dataTransfer.setData("text/plain", JSON.stringify({ type: "acks-extras.groupStack", group: game.actors.get(groupId).uuid, stackKey, count: 1 }));
    else {
      const grip = H.root(H.sheetOf(groupId))?.querySelector(`[data-stack-key="${stackKey}"] .stack-grab`);
      grip?.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
    }
    const carried = dataTransfer.getData("text/plain");
    document.getElementById("board").dispatchEvent(new DragEvent("drop", {
      bubbles: true, cancelable: true, dataTransfer, clientX: client.x, clientY: client.y, shiftKey: shift, altKey: alt,
    }));
    await H.sleep(500);
    return { carried: carried ? JSON.parse(carried) : null, point };
  },

  /** A group's bodies on a scene. The collection does not hold them in the order they were placed. */
  bodies: async ({ sceneId, groupId }) => {
    const uuid = game.actors.get(groupId).uuid;
    return game.scenes.get(sceneId).tokens
      .filter((t) => t.getFlag("acks-extras", "group") === uuid)
      .map((t) => ({ uuid: t.uuid, x: t.x, y: t.y, hidden: t.hidden, linked: t.actorLink }));
  },

  press: async ({ groupId, selector }) => {
    const H = globalThis.__ge;
    const control = H.root(H.sheetOf(groupId))?.querySelector(selector);
    if (!control) return { found: false };
    control.click();
    await H.sleep(250);
    return { found: true };
  },

  /** One field, the way a user changes it: a value, then the change event. */
  field: async ({ groupId, selector, value }) => {
    const H = globalThis.__ge;
    const el = H.root(H.sheetOf(groupId))?.querySelector(selector);
    if (!el) return { found: false };
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    await H.sleep(350);
    return { found: true };
  },

  /** The open dialogs of this feature, as a Judge reads them. */
  dialogs: async () => {
    const H = globalThis.__ge;
    const all = H.dialogs();
    const read = (app) => {
      const el = H.root(app);
      const select = (name) => el.querySelector(`select[name="${name}"]`);
      const options = (name) => [...(select(name)?.options ?? [])].map((o) => ({ value: o.value, disabled: o.disabled, text: H.text(o) }));
      return {
        title: H.text(el.querySelector(".window-title")),
        context: select("context")?.value ?? null,
        contexts: options("context"),
        states: options("state"),
        selects: el.querySelectorAll("select").length,
        line: { text: H.text(el.querySelector("[data-roll-line]")), tip: el.querySelector("[data-roll-line]")?.dataset.tooltipText ?? "" },
        scrolls: el.classList.contains("acks-extras-scroll"),
      };
    };
    return { count: all.length, list: all.map(read) };
  },

  /** Choose in one dialog and press its button. */
  answer: async ({ index = 0, values = {} }) => {
    const H = globalThis.__ge;
    const app = H.dialogs()[index];
    if (!app) return { found: false };
    const el = H.root(app);
    for (const [name, value] of Object.entries(values)) el.querySelector(`select[name="${name}"]`).value = value;
    el.querySelector("[data-action='ok']").click();
    await H.poll(() => !H.dialogs().includes(app));
    return { found: true };
  },

  dismiss: async () => {
    const H = globalThis.__ge;
    for (const app of H.dialogs()) await app.close();
    return H.dialogs().length;
  },

  state: async ({ groupId }) => {
    const a = game.actors.get(groupId);
    const p = a.prototypeToken;
    return {
      noun: a.system.noun,
      reveal: a.system.reveal,
      img: a.img,
      folder: a.folder?.name ?? null,
      proto: { name: p.name, src: p.texture.src, link: p.actorLink, disposition: p.disposition, displayName: p.displayName },
      list: a.system.stacks.map((s) => ({
        key: s.key,
        label: s.template?.label,
        uuid: s.template?.uuid,
        current: s.size.current,
        initial: s.size.initial,
        formula: s.size.formula,
        rolled: s.rolled,
        roster: s.roster.length,
        deployed: s.roster.filter((m) => m.state === "deployed").length,
        hp: s.roster.map((m) => m.delta?.system?.hp?.max ?? null),
      })),
    };
  },

  /** The newest card of a group's Roll since a moment. */
  card: async ({ groupId, since }) => {
    const H = globalThis.__ge;
    const uuid = game.actors.get(groupId).uuid;
    const m = [...game.messages].filter((x) => x.timestamp >= since && x.getFlag("acks-extras", "groupRoll")?.group === uuid).pop();
    if (!m) return null;
    const el = document.createElement("div");
    el.innerHTML = m.content;
    const line = el.querySelector("[data-kind]");
    return {
      id: m.id,
      whisper: [...m.whisper].sort(),
      gms: game.users.filter((u) => u.isGM).map((u) => u.id).sort(),
      rolls: m.rolls.length,
      speaker: m.speaker?.alias ?? null,
      text: H.text(el),
      line: { kind: line?.dataset.kind ?? null, text: H.text(line) },
      flag: m.getFlag("acks-extras", "groupRoll"),
    };
  },

  /** Every card of a group's Roll since a moment, by id. */
  cardIds: async ({ groupId, since }) => {
    const uuid = game.actors.get(groupId).uuid;
    return [...game.messages].filter((x) => x.timestamp >= since && x.getFlag("acks-extras", "groupRoll")?.group === uuid).map((x) => x.id);
  },

  /** A whisper reaches every client; what it may not do is show there. */
  sees: async ({ id }) => {
    const message = game.messages.get(id);
    return { arrived: !!message, visible: !!message?.visible, shown: !!document.querySelector(`[data-message-id="${id}"]`) };
  },

  viewScene: async ({ sceneId }) => {
    const H = globalThis.__ge;
    const scene = game.scenes.get(sceneId);
    await scene.view();
    return !!(await H.poll(() => canvas.ready && canvas.scene?.id === sceneId, { tries: 100 }));
  },

  /** This actor's token on the scene: the one standing there, or a new one from its prototype. */
  place: async ({ sceneId, actorId, x = 300, y = 300 }) => {
    const scene = game.scenes.get(sceneId);
    const actor = game.actors.get(actorId);
    const had = scene.tokens.find((t) => t.actorId === actorId);
    if (had) return { id: had.id, uuid: had.uuid, kept: true };
    const data = (await actor.getTokenDocument({ x, y })).toObject();
    const [doc] = await scene.createEmbeddedDocuments("Token", [data]);
    return { id: doc.id, uuid: doc.uuid, kept: false };
  },

  /** A token's face: the source's art, since a texture change tweens on the document. */
  face: async ({ sceneId, tokenId }) => {
    const doc = game.scenes.get(sceneId).tokens.get(tokenId);
    return { name: doc.name, src: doc._source.texture.src, plate: doc.object?.nameplate?.text ?? null };
  },

  setSystem: async ({ sceneId, mapSystem }) => {
    await game.scenes.get(sceneId).setFlag("acks-extras", "battlemap", { mapSystem });
    return true;
  },

  /** Every kept party whose scene declares nothing, with the line that scene reads. */
  partyLines: async () => {
    const H = globalThis.__ge;
    const formations = Object.values(game.settings.get("acks-extras", "formations") ?? {});
    return formations.flatMap((f) => {
      const scene = game.scenes.get(f.sceneId);
      if (!scene || H.travel.inferredTravelSystem(scene).system) return [];
      return [{ mode: H.travel.travelOf(f).mode, line: H.travel.sceneEncounterLine(scene) }];
    });
  },

  /** The monster sheet, opened as itself: whether it offers the tool. */
  monsterTool: async ({ actorId, press }) => {
    const H = globalThis.__ge;
    const actor = game.actors.get(actorId);
    const Cls = Object.values(CONFIG.Actor.sheetClasses.monster).map((e) => e.cls).find((c) => c.name === "FullMonsterSheet");
    const app = new Cls({ document: actor });
    await app.render(true);
    await H.poll(() => H.root(app)?.querySelector(".acks-extras-frame"));
    const tool = H.root(app)?.querySelector("[data-action='makeEncounter']");
    const out = { rendered: !!H.root(app), tool: !!tool, editable: app.isEditable, label: tool?.getAttribute("aria-label") ?? tool?.dataset.tooltip ?? null };
    if (tool && press) {
      const before = new Set(foundry.applications.instances.keys());
      tool.click();
      const fresh = await H.poll(() => [...foundry.applications.instances.values()].find((a) => !before.has(a.id) && a.document?.type === "acks-extras.group" && a.rendered));
      out.groupId = fresh?.document.id ?? null;
    }
    await app.close({ force: true });
    return out;
  },

  /** Font sizes the type knob should reach, and whether the band fits. */
  measure: async ({ groupId }) => {
    const H = globalThis.__ge;
    const root = H.root(H.sheetOf(groupId));
    const px = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : null);
    const bands = [...root.querySelectorAll(".acks-lib-group-encounter, .stack-head")];
    const grip = root.querySelector(".stack-grab")?.getBoundingClientRect();
    const actions = root.querySelector(".stack-actions")?.getBoundingClientRect();
    return {
      oneLine: actions?.left >= grip?.right && actions?.top < grip?.bottom && grip?.top < actions?.bottom,
      roll: px(root.querySelector("[data-action='rollEncounter']")),
      reveal: px(root.querySelector("select[name='system.reveal']")),
      face: px(root.querySelector(".acks-lib-group-encounter__face")),
      note: px(root.querySelector(".stack-roll-note")),
      bands: bands.length,
      overflow: bands.some((band) => band.scrollWidth > band.clientWidth),
      width: Math.round(root.getBoundingClientRect().width),
      clipped: bands.flatMap((band) => [...band.querySelectorAll("button, select, input")]).filter((el) => el.getBoundingClientRect().right > root.getBoundingClientRect().right + 1).length,
    };
  },

  setWidth: async ({ groupId, width }) => {
    const H = globalThis.__ge;
    H.sheetOf(groupId).setPosition({ width });
    await H.sleep(200);
    return true;
  },

  measureDialog: async () => {
    const H = globalThis.__ge;
    const el = H.root(H.dialogs()[0]);
    if (!el) return null;
    const px = (node) => (node ? parseFloat(getComputedStyle(node).fontSize) : null);
    const content = el.querySelector(".window-content");
    return {
      select: px(el.querySelector("select")),
      line: px(el.querySelector(".acks-lib-group-roll__line")),
      scroll: getComputedStyle(content).overflowY,
      overflow: content.scrollWidth > content.clientWidth,
    };
  },

  /** Writes the type knob on this page as `applyFontScale` does; the client setting stays as it was. */
  setBase: async ({ base }) => {
    const style = document.documentElement.style;
    const before = style.getPropertyValue("--acks-fs-base");
    if (base) style.setProperty("--acks-fs-base", base);
    else style.removeProperty("--acks-fs-base");
    return { before };
  },

  /** A chat card in the log, for its plate. */
  showCard: async ({ id }) => {
    const H = globalThis.__ge;
    H.popout = new CONFIG.ChatMessage.popoutClass({ message: game.messages.get(id) });
    await H.popout.render(true);
    return !!(await H.poll(() => H.root(H.popout)?.querySelector(".acks-lib-group-roll-card")));
  },

  closeAll: async () => {
    const H = globalThis.__ge;
    for (const app of H.dialogs()) await app.close();
    await H.popout?.close();
    for (const app of [...foundry.applications.instances.values()]) {
      if (app.document?.type === "acks-extras.group") await app.close({ force: true });
    }
    return true;
  },
};

const run = (api, fn, arg) => api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);

/** Read a page function until `test` passes, or give the last reading back. */
async function until(api, fn, arg, test, { tries = 40, every = 150 } = {}) {
  let value;
  for (let n = 0; n < tries; n++) {
    value = await run(api, fn, arg);
    if (test(value)) return value;
    await sleep(every);
  }
  return value;
}

const ready = async (api, label) => {
  for (let n = 0; n < 240; n++) {
    const ok = await api.eval(`!!(globalThis.game?.ready && globalThis.acksExtras?.lib)`).catch(() => false);
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
const swept = [];
const stackKey = (key, action) =>`[data-stack-key="${key}"] [data-action="${action}"]`;
const stackField = (key, field) => `[data-stack-key="${key}"] input[data-stack-size="${field}"]`;

/** One count typed on the sheet, waited for: a second patch read before the first lands writes over it. */
async function setCount(groupId, key, field, value) {
  await run(open.gm, P.field, { groupId, selector: stackField(key, field), value });
  return until(open.gm, P.state, { groupId }, (s) => s.list.find((stack) => stack.key === key)?.[field] === value);
}

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
  check("the GM seat is the active GM, and the player seat is a player", census.gm.activeGMIsSelf && census.player.role <= 2, { gm: census.gm.role, player: census.player.role });
  if (!census.gm.activeGMIsSelf) throw new Error("another client is the active GM; the automation would run there");
  for (const [key, c] of Object.entries(census)) {
    check(`${key} seat: no error from load through ready`, c.boot?.phases.length === 3 && !c.boot.errors.length, c.boot);
  }

  section("fixtures");
  const beast = (name) => ({ name, type: "monster", img: ART, items: [], prototypeToken: { texture: { src: ART } } });
  const lined = await gm.fixture("lib/encounter-lined", "Actor", beast("QA Knot"));
  const units = await gm.fixture("lib/encounter-units", "Actor", beast("QA Swarm"));
  const mute = await gm.fixture("lib/encounter-mute", "Actor", beast("QA Mute"));
  await run(gm, P.setLines, { actorId: lined.id, encounter: LINED });
  await run(gm, P.setLines, { actorId: units.id, encounter: UNITS });
  await run(gm, P.setLines, { actorId: mute.id, encounter: MUTE });
  const band = await gm.fixture("lib/encounter-band", "Actor", { name: "QA Band", type: GROUP, items: [] });
  const second = await gm.fixture("lib/encounter-second", "Actor", { name: "QA Second", type: GROUP, items: [] });
  const unlinked = await gm.fixture("lib/encounter-unlinked", "Actor", { name: "QA Unlinked", type: GROUP, items: [], prototypeToken: { actorLink: false } });
  const scene = await gm.fixture("lib/encounter-scene", "Scene", { name: "Encounter Walk", width: 1200, height: 800, grid: { size: 100 }, ownership: { default: 2 } });
  const flags = { [SCOPE]: { extras: { encounter: LINED } } };
  const family = await gm.fixture("lib/encounter-family", "Actor", {
    name: "QA Family",
    type: TEMPLATE,
    items: [],
    system: {
      output: { actorType: "monster", nameFormat: "QA {size}" },
      axes: [{ key: "size", label: "Size", roll: "", options: [{ key: "small", label: "Small", flags }, { key: "large", label: "Large", flags }] }],
    },
  });
  await run(gm, P.setSystem, { sceneId: scene.id, mapSystem: null });
  for (const api of [gm, player]) check("the seat views the walk's scene", await run(api, P.viewScene, { sceneId: scene.id }));
  const judge = census.player.userId;
  const fresh = await gm.create("Actor", { name: "QA Fresh", type: GROUP, items: [] });
  swept.push(fresh.uuid);
  check("a group made with no word on it is linked", (await run(gm, P.state, { groupId: fresh.id })).proto.link === true);
  note("seat", judge);

  section("a monster dropped on a group");
  await run(gm, P.reset, { groupId: band.id });
  await run(gm, P.grant, { actorId: band.id, name: SEATS.player, level: 0 });
  await run(gm, P.open, { actorId: band.id });
  let view = await run(gm, P.view, { groupId: band.id });
  check("a group with nothing in it offers no Roll", view.roll === null && view.reveal === null, view);
  check("a band of monsters draws no purse, troop type or loyalty", !view.purse && !view.troopType && !view.loyalty && view.category && view.morale, view);
  check("no title attribute is left on the sheet, and every glyph control has a name", view.titles === 0 && view.unnamed === 0, { titles: view.titles, unnamed: view.unnamed });
  await run(gm, P.field, { groupId: band.id, selector: "[name='system.unit.category']", value: "mercenary" });
  view = await until(gm, P.view, { groupId: band.id }, (v) => v.purse);
  check("a mercenary unit keeps them", view.purse && view.troopType && view.loyalty, view);
  await run(gm, P.field, { groupId: band.id, selector: "[name='system.unit.category']", value: "monster" });
  await until(gm, P.view, { groupId: band.id }, (v) => !v.purse);

  await run(gm, P.drop, { groupId: band.id, actorId: lined.id });
  view = await until(gm, P.view, { groupId: band.id }, (v) => v.stacks === 1 && !!v.roll);
  check("the drop adds the stack, with a Roll on its row", view.stacks === 1 && view.rolls[0] === "Roll", view);
  check("and no reveal until there is an encounter", view.reveal === null);

  /** Press a row's Roll, the first unless a stack is named, answer its dialog, and read the card back. */
  const roll = async (groupId, values, key) => {
    const since = await run(gm, P.nowMs);
    await run(gm, P.press, { groupId, selector: key ? stackKey(key, "rollEncounter") : "[data-action='rollEncounter']" });
    const dialog = await until(gm, P.dialogs, null, (d) => d.count > 0);
    await run(gm, P.answer, { values });
    const card = await until(gm, P.card, { groupId, since }, (c) => !!c);
    if (card) swept.push(gm.track(card.id, "ChatMessage"));
    return { dialog: dialog.list[0], card };
  };

  section("the Roll, wandering");
  let pressed = await roll(band.id, { context: "wilderness", state: "wandering" });
  const asked = pressed.dialog;
  note("dialog", asked);
  check("the dialog offers both lines, opening on wilderness on a scene that says nothing", asked.context === "wilderness" && asked.contexts.map((o) => o.value).join() === "dungeon,wilderness", asked.contexts);
  check("and both sides and the lair chance, with its figure", asked.states.map((o) => o.value).join() === "wandering,lair,chance" && !asked.states[2].disabled && asked.states[2].text.includes("40%"), asked.states);
  check("and that monster's line reads out before the press, with its provenance", asked.title.includes("QA Knot") && asked.line.text.includes("2d3+1") && asked.line.text.includes("3d3") && asked.line.tip.includes("this creature's sheet"), asked.line);
  check("the dialog carries the scroll contract", asked.scrolls);
  let state = await until(gm, P.state, { groupId: band.id }, (s) => s.proto.name === "Muster");
  let [stack] = state.list;
  note("state", state);
  check("the count lands in the side's range, both counts at once", within(stack.current, 3, 7) && stack.initial === stack.current && stack.formula === "2d3+1", stack);
  check("what the roll was stands on the stack", stack.rolled.total === stack.current && stack.rolled.state === "wandering" && stack.rolled.context === "wilderness" && stack.rolled.noun === "muster", stack.rolled);
  check("no body has a figure: the bodies stay pristine", stack.roster === 0);
  check("the noun comes off the side", state.noun === "muster");
  check("the first Roll makes it an encounter", state.reveal === "noun" && state.img === ART && state.proto.link && state.proto.disposition === -1 && state.proto.displayName === 30, state.proto);
  check("the prototype is masked", state.proto.src !== ART && state.proto.name === "Muster", state.proto);
  const card = pressed.card;
  note("card", card);
  check("one card, to the Judges alone, with no rolls a seat would see", !!card && card.whisper.join() === card.gms.join() && card.rolls === 0, card && { whisper: card.whisper.length, rolls: card.rolls });
  check("it shows the work", card?.line.kind === "roll" && card.line.text.includes("2d3+1") && card.line.text.includes(`= ${stack.current}`) && card.text.includes("Wilderness") && card.text.includes("Wandering"), card?.text);
  check("the page is cited", card?.text.includes("JJ ch. 2"));
  const seen = await until(player, P.sees, { id: card?.id }, (s) => s.arrived);
  check("a player's seat is shown nothing of it", seen.arrived && !seen.visible && !seen.shown, seen);
  view = await until(gm, P.view, { groupId: band.id }, (v) => v.reveal === "noun");
  check("the sheet now offers Roll again and the reveal", view.roll === "Roll again" && view.reveal === "noun", view);
  check("the count says where it came from", view.tips[0].includes("2d3+1") && view.tips[0].includes(`= ${stack.current}`) && view.tips[0].includes("JJ ch. 2"), view.tips);
  check("the total names its parts", view.totalTip.includes("QA Knot") && view.totalTip.includes(String(stack.current)), view.totalTip);
  check("every count stays editable", view.sizeInputs === 2, view.sizeInputs);

  section("a count a hand changed");
  const raised = stack.current + 2;
  await setCount(band.id, stack.key, "current", raised);
  state = await setCount(band.id, stack.key, "initial", raised);
  check("the sheet writes both", state.list[0].current === raised && state.list[0].initial === raised, state.list[0]);
  view = await until(gm, P.view, { groupId: band.id }, (v) => v.tips[0].includes("changed by hand"));
  check("and the tooltip says the hand changed it", view.tips[0].includes("changed by hand") && view.tips[0].includes("2d3+1"), view.tips);
  await run(gm, P.field, { groupId: band.id, selector: "[name='system.noun']", value: "rabble" });
  await until(gm, P.state, { groupId: band.id }, (s) => s.noun === "rabble");

  section("rolled again, in the lair and by the chance");
  pressed = await roll(band.id, { context: "wilderness", state: "lair" });
  state = await until(gm, P.state, { groupId: band.id }, (s) => s.list[0].rolled.state === "lair");
  check("a roll over a hand's change reads the lair side", state.list[0].formula === "3d3" && within(state.list[0].current, 3, 9), state.list[0]);
  check("a noun a hand typed stands", state.noun === "rabble");
  await run(gm, P.field, { groupId: band.id, selector: "[name='system.noun']", value: "" });
  await until(gm, P.state, { groupId: band.id }, (s) => s.noun === "");
  pressed = await roll(band.id, { context: "dungeon", state: "chance" });
  state = await until(gm, P.state, { groupId: band.id }, (s) => s.list[0].rolled.context === "dungeon");
  note("by chance", { flag: pressed.card?.flag, text: pressed.card?.text });
  const inLair = pressed.card?.flag?.inLair;
  check("the chance throws first and the card shows it", typeof inLair === "boolean" && pressed.card.text.includes("lair chance 40%") && pressed.card.text.includes("d100"), pressed.card?.text);
  check("the side the card names is the side rolled", state.list[0].rolled.state === (inLair ? "lair" : "wandering") && state.list[0].formula === (inLair ? "2d3" : "1d3"), state.list[0]);
  check("the noun is the side's", state.noun === (inLair ? "roost" : "knot"), state.noun);

  section("a monster's Roll, beside the others");
  await run(gm, P.drop, { groupId: band.id, actorId: mute.id });
  view = await until(gm, P.view, { groupId: band.id }, (v) => v.stacks === 2);
  check("a stack with no count says so on the sheet and offers no Roll", view.notes[1][0]?.includes("No count is imported") && view.rolls[1] === null, view.notes);
  await run(gm, P.drop, { groupId: band.id, actorId: units.id });
  view = await until(gm, P.view, { groupId: band.id }, (v) => v.stacks === 3);
  check("a stack in units says which sides, and that a Roll leaves them", view.notes[2][0]?.includes("knots") && view.notes[2][0].includes("Counted in units") && view.notes[2][0].includes("Wilderness, Wandering"), view.notes);
  check("each row has its own Roll, by what it has done", view.rolls.join() === "Roll again,,Roll", view.rolls);
  state = await run(gm, P.state, { groupId: band.id });
  const [lead, , swarm] = state.list;
  let warned = await run(gm, P.warnCount);
  await run(gm, P.press, { groupId: band.id, selector: stackKey(swarm.key, "rollEncounter") });
  const unitDialog = await until(gm, P.dialogs, null, (d) => d.count > 0);
  check("a press opens that monster's dialog", unitDialog.list[0].title.includes("QA Swarm") && unitDialog.list[0].line.text.includes("1d3 knots"), unitDialog.list[0].line);
  await run(gm, P.answer, { values: { context: "wilderness", state: "wandering" } });
  let warns = await until(gm, P.warnsAfter, warned, (w) => w.length > 0);
  state = await run(gm, P.state, { groupId: band.id });
  check("a side in units says so and writes nothing", warns[0]?.includes("QA Swarm") && warns[0].includes("counted in units") && state.list[2].current === 0 && state.list[2].rolled.total === null, warns);
  pressed = await roll(band.id, { context: "wilderness", state: "lair" }, swarm.key);
  state = await until(gm, P.state, { groupId: band.id }, (s) => s.list[2].current > 0);
  note("after the second monster", state.list);
  check("a press sizes that monster alone", state.list[2].formula === "2d3" && state.list[0].current === lead.current && state.list[0].rolled.total === lead.rolled.total && state.list[0].formula === lead.formula && state.list[1].current === 0, state.list);
  check("and its card names that monster alone", pressed.card?.line.text.includes("QA Swarm") && !pressed.card.text.includes("QA Knot"), pressed.card?.text);
  check("the noun stays the roll's that wrote it", state.noun === (inLair ? "roost" : "knot"), state.noun);
  const swarmRolled = state.list[2];
  await roll(band.id, { context: "wilderness", state: "wandering" }, lead.key);
  state = await until(gm, P.state, { groupId: band.id }, (s) => s.list[0].formula === "2d3+1");
  check("a re-roll replaces that monster's roll and nothing else", state.list[2].current === swarmRolled.current && state.list[2].rolled.total === swarmRolled.rolled.total && state.list[2].formula === "2d3", state.list);

  section("a stack with no Roll to press");
  await run(gm, P.reset, { groupId: second.id });
  await run(gm, P.open, { actorId: second.id });
  await run(gm, P.drop, { groupId: second.id, actorId: lined.id });
  await until(gm, P.view, { groupId: second.id }, (v) => v.stacks === 1);
  state = await run(gm, P.state, { groupId: second.id });
  const handKey = state.list[0].key;
  await setCount(second.id, handKey, "current", 4);
  await setCount(second.id, handKey, "initial", 4);
  view = await until(gm, P.view, { groupId: second.id }, (v) => v.notes[0][0]?.includes("Set by hand"));
  check("a count set by hand says so, and its row offers no Roll", view.notes[0][0]?.includes("Set by hand") && view.rolls[0] === null, view);
  await setCount(second.id, handKey, "current", 0);
  await setCount(second.id, handKey, "initial", 0);
  view = await until(gm, P.view, { groupId: second.id }, (v) => v.rolls[0] === "Roll");
  check("zeroing both counts gives the row its Roll back", view.rolls[0] === "Roll" && !view.notes[0].length, view);
  await run(gm, P.reset, { groupId: second.id });
  await run(gm, P.setLines, { actorId: units.id, encounter: ALL_UNITS });
  await run(gm, P.drop, { groupId: second.id, actorId: units.id });
  view = await until(gm, P.view, { groupId: second.id }, (v) => v.stacks === 1);
  check("a line of units on every side offers no Roll, and says which", view.rolls[0] === null && view.notes[0][0]?.includes("Counted in units") && view.notes[0][0].includes("In lair"), view);
  await run(gm, P.setLines, { actorId: units.id, encounter: UNITS });

  section("a body on record stops that monster's press");
  await run(gm, P.reset, { groupId: band.id });
  await run(gm, P.drop, { groupId: band.id, actorId: lined.id });
  await until(gm, P.view, { groupId: band.id }, (v) => v.stacks === 1);
  await roll(band.id, { context: "wilderness", state: "wandering" });
  state = await until(gm, P.state, { groupId: band.id }, (s) => s.list[0]?.rolled.total != null);
  stack = state.list[0];
  await run(gm, P.press, { groupId: band.id, selector: stackKey(stack.key, "materialize") });
  state = await until(gm, P.state, { groupId: band.id }, (s) => s.list[0].roster === 1);
  check("Individuate makes one body, with hit points of its own", state.list[0].roster === 1, state.list[0]);
  warned = await run(gm, P.warnCount);
  await run(gm, P.press, { groupId: band.id, selector: "[data-action='rollEncounter']" });
  warns = await until(gm, P.warnsAfter, warned, (w) => w.length > 0);
  check("the Roll refuses before any dialog, naming the stack", warns[0]?.includes("QA Knot") && (await run(gm, P.dialogs)).count === 0, warns);
  await run(gm, P.reset, { groupId: band.id });
  await run(gm, P.drop, { groupId: band.id, actorId: lined.id });
  await until(gm, P.view, { groupId: band.id }, (v) => v.stacks === 1);
  await roll(band.id, { context: "wilderness", state: "wandering" });
  state = await until(gm, P.state, { groupId: band.id }, (s) => s.list[0]?.rolled.total != null);
  stack = state.list[0];
  await run(gm, P.press, { groupId: band.id, selector: stackKey(stack.key, "addCasualty") });
  state = await until(gm, P.state, { groupId: band.id }, (s) => s.list[0].current === stack.current - 1);
  warned = await run(gm, P.warnCount);
  await run(gm, P.press, { groupId: band.id, selector: "[data-action='rollEncounter']" });
  warns = await until(gm, P.warnsAfter, warned, (w) => w.length > 0);
  check("and so does a body that fell with no record", warns[0]?.includes("QA Knot") && (await run(gm, P.dialogs)).count === 0, { warns, stack: state.list[0] });
  view = await run(gm, P.view, { groupId: band.id });
  check("a fallen body leaves the count the roll's", view.tips[0].includes("Rolled") && !view.tips[0].includes("changed by hand"), view.tips);
  await run(gm, P.drop, { groupId: band.id, actorId: units.id });
  state = await until(gm, P.state, { groupId: band.id }, (s) => s.list.length === 2);
  await roll(band.id, { context: "wilderness", state: "lair" }, state.list[1].key);
  state = await until(gm, P.state, { groupId: band.id }, (s) => s.list[1].current > 0);
  check("and the monster beside it still rolls", state.list[1].formula === "2d3" && state.list[0].roster === 0 && state.list[0].current === stack.current - 1, state.list);

  section("the token");
  await run(gm, P.reset, { groupId: band.id });
  await run(gm, P.drop, { groupId: band.id, actorId: lined.id });
  await until(gm, P.view, { groupId: band.id }, (v) => v.stacks === 1);
  await roll(band.id, { context: "wilderness", state: "wandering" });
  state = await until(gm, P.state, { groupId: band.id }, (s) => s.proto.name === "Muster");
  stack = state.list[0];
  const placed = await run(gm, P.place, { sceneId: scene.id, actorId: band.id });
  note("token", placed);
  const seat = { sceneId: scene.id, tokenId: placed.id };
  const caption = (n) => `QA Knot, muster of ${n}`;
  const masked = (f) => f.name === "Muster" && f.src !== ART;
  let onGm = await until(gm, P.face, seat, (f) => masked(f) && f.plate === caption(stack.current));
  let onPlayer = await until(player, P.face, seat, (f) => masked(f) && f.plate === "Muster");
  note("noun", { onGm, onPlayer });
  check("below a full reveal a player reads the noun, with the art masked", masked(onPlayer) && onPlayer.plate === "Muster", onPlayer);
  check("the Judge's own nameplate reads the name and the count", onGm.plate === caption(stack.current) && masked(onGm), onGm);
  view = await run(gm, P.view, { groupId: band.id });
  check("the sheet says what a player reads", view.reads?.includes("Muster"), view.reads);
  const changed = stack.current + 2;
  await setCount(band.id, stack.key, "current", changed);
  onGm = await until(gm, P.face, seat, (f) => f.plate === caption(changed));
  check("a count that changes reaches the Judge's nameplate", onGm.plate === caption(changed), onGm);
  await run(gm, P.field, { groupId: band.id, selector: "select[name='system.reveal']", value: "full" });
  onPlayer = await until(player, P.face, seat, (f) => f.name === caption(changed));
  onGm = await run(gm, P.face, seat);
  note("full", { onGm, onPlayer });
  check("a full reveal gives a player the name, the count and the art", onPlayer.name === caption(changed) && onPlayer.src === ART && onPlayer.plate === caption(changed), onPlayer);
  check("the prototype follows", (await until(gm, P.state, { groupId: band.id }, (s) => s.proto.name === caption(changed))).proto.src === ART);
  await setCount(band.id, stack.key, "current", changed + 1);
  onPlayer = await until(player, P.face, seat, (f) => f.name === caption(changed + 1));
  check("at a full reveal a change of count reaches the token", onPlayer.name === caption(changed + 1), onPlayer);
  await run(gm, P.field, { groupId: band.id, selector: "select[name='system.reveal']", value: "noun" });
  onPlayer = await until(player, P.face, seat, masked);
  check("turned back, the token masks again", masked(onPlayer), onPlayer);

  section("Make Encounter");
  const made = await run(gm, P.monsterTool, { actorId: lined.id, press: true });
  note("tool", made);
  check("the monster sheet offers it to a Judge, and a press opens the group", made.tool && !!made.groupId, made);
  swept.push(gm.track(made.groupId, "Actor"));
  state = await until(gm, P.state, { groupId: made.groupId }, (s) => s.list.length === 1);
  note("made", state);
  check("the group holds the creature, filed in the encounters folder", state.list[0]?.uuid.endsWith(lined.id) && state.folder === "Encounters", state.folder);
  check("masked, linked, hostile, an encounter from the first", state.reveal === "noun" && state.proto.link && state.proto.disposition === -1 && state.proto.src !== ART && state.proto.name === "Pack", state.proto);
  const early = await run(gm, P.place, { sceneId: scene.id, actorId: made.groupId, x: 500 });
  swept.unshift(gm.track(early.uuid, "Token"));
  const earlySeat = { sceneId: scene.id, tokenId: early.id };
  onPlayer = await until(player, P.face, earlySeat, (f) => f.name === "Pack");
  check("a token placed before the Roll gives nothing away", onPlayer.name === "Pack" && onPlayer.src !== ART, onPlayer);
  check("on the GM seat the sheet is open on the row's Roll", (await run(gm, P.view, { groupId: made.groupId }))?.roll === "Roll");
  pressed = await roll(made.groupId, { context: "wilderness", state: "wandering" });
  onPlayer = await until(player, P.face, earlySeat, (f) => f.name === "Muster");
  check("a Roll carries the noun to the token standing there", onPlayer.name === "Muster" && onPlayer.src !== ART, onPlayer);
  await run(gm, P.close, { actorId: made.groupId });

  section("the Player seat");
  check("a player has no sight of a group with no grant", !(await run(player, P.open, { actorId: band.id }).catch(() => false)));
  await run(gm, P.grant, { actorId: band.id, name: SEATS.player, level: 2 });
  await run(player, P.open, { actorId: band.id });
  view = await until(player, P.view, { groupId: band.id }, (v) => !!v);
  note("observer", view);
  check("an Observer reads the sheet and has no Roll, no reveal, no field", view?.roll === null && view?.reveal === null && view?.sizeInputs === 0 && view?.fields === 0, view);
  const [{ key: held, current: heldCount, initial: heldStart }] = (await run(gm, P.state, { groupId: band.id })).list;
  let heldRow = await run(player, P.row, { groupId: band.id, stackKey: held });
  check("an Observer reads the row's count as text, with nothing on it to drag", heldRow.count.startsWith(`${heldCount} / ${heldStart}`) && !heldRow.fields.length && !heldRow.draggable, heldRow);
  await run(player, P.close, { actorId: band.id });
  await run(gm, P.grant, { actorId: band.id, name: SEATS.player, level: 3 });
  await run(player, P.open, { actorId: band.id });
  view = await until(player, P.view, { groupId: band.id }, (v) => !!v);
  note("owner", view);
  check("an Owner has the fields and still no Roll and no reveal: both are the Judge's", view?.sizeInputs === 2 && view?.roll === null && view?.reveal === null, view);
  heldRow = await run(player, P.row, { groupId: band.id, stackKey: held });
  check("an Owner with no right to place tokens has no grip and no Deploy", !view?.canPlace && !heldRow.draggable && !heldRow.tip && !heldRow.deploy, { canPlace: view?.canPlace, heldRow });
  warned = await run(player, P.warnCount);
  await run(player, P.dragRow, { groupId: band.id, stackKey: held, at: { x: 330, y: 330 }, forged: true });
  warns = await until(player, P.warnsAfter, warned, (w) => w.length > 0);
  check("and a drop sent anyway warns and places nothing", warns?.[0]?.includes("cannot place tokens") && !(await run(gm, P.bodies, { sceneId: scene.id, groupId: band.id })).length, warns);
  await run(player, P.close, { actorId: band.id });
  await run(gm, P.grant, { actorId: band.id, name: SEATS.player, level: 0 });
  await run(gm, P.grant, { actorId: lined.id, name: SEATS.player, level: 3 });
  const offered = await run(player, P.monsterTool, { actorId: lined.id });
  await run(gm, P.grant, { actorId: lined.id, name: SEATS.player, level: 0 });
  check("a player who owns a monster is not offered Make Encounter", offered.rendered && offered.editable && !offered.tool, offered);

  section("two sheets and two dialogs");
  await run(gm, P.reset, { groupId: second.id });
  await run(gm, P.close, { actorId: second.id });
  await run(gm, P.open, { actorId: second.id });
  await run(gm, P.reset, { groupId: band.id });
  await run(gm, P.drop, { groupId: band.id, actorId: lined.id });
  await run(gm, P.drop, { groupId: second.id, actorId: lined.id });
  await until(gm, P.view, { groupId: band.id }, (v) => v.stacks === 1);
  await until(gm, P.view, { groupId: second.id }, (v) => v.stacks === 1);
  check("a drop reaches its own sheet alone", (await run(gm, P.view, { groupId: band.id })).stacks === 1 && (await run(gm, P.view, { groupId: second.id })).stacks === 1);
  const since = await run(gm, P.nowMs);
  await run(gm, P.press, { groupId: band.id, selector: "[data-action='rollEncounter']" });
  await until(gm, P.dialogs, null, (d) => d.count === 1);
  await run(gm, P.press, { groupId: second.id, selector: "[data-action='rollEncounter']" });
  const both = await until(gm, P.dialogs, null, (d) => d.count === 2);
  check("each sheet opens a dialog of its own", both.count === 2, both.list.map((d) => d.title));
  await run(gm, P.answer, { index: 1, values: { context: "dungeon", state: "lair" } });
  await run(gm, P.answer, { index: 0, values: { context: "wilderness", state: "wandering" } });
  const a = await until(gm, P.state, { groupId: band.id }, (s) => s.list[0].rolled.total != null);
  const b = await until(gm, P.state, { groupId: second.id }, (s) => s.list[0].rolled.total != null);
  check("each dialog's choice reaches its own group", a.list[0].formula === "2d3+1" && b.list[0].formula === "2d3", [a.list[0].formula, b.list[0].formula]);
  for (const groupId of [band.id, second.id]) {
    const posted = await until(gm, P.card, { groupId, since }, (c) => !!c);
    if (posted) swept.push(gm.track(posted.id, "ChatMessage"));
  }
  await run(gm, P.drop, { groupId: band.id, actorId: units.id });
  state = await until(gm, P.state, { groupId: band.id }, (s) => s.list.length === 2);
  const [rowA, rowB] = state.list;
  const sinceRows = await run(gm, P.nowMs);
  await run(gm, P.press, { groupId: band.id, selector: stackKey(rowA.key, "rollEncounter") });
  await until(gm, P.dialogs, null, (d) => d.count === 1);
  await run(gm, P.press, { groupId: band.id, selector: stackKey(rowB.key, "rollEncounter") });
  const rows = await until(gm, P.dialogs, null, (d) => d.count === 2);
  check("each row of one sheet opens a dialog of its own", rows.count === 2 && rows.list[0].title !== rows.list[1].title, rows.list.map((d) => d.title));
  await run(gm, P.answer, { index: 1, values: { context: "wilderness", state: "lair" } });
  await run(gm, P.answer, { index: 0, values: { context: "dungeon", state: "lair" } });
  state = await until(gm, P.state, { groupId: band.id }, (s) => s.list[1].formula === "2d3" && s.list[0].rolled.context === "dungeon");
  check("each dialog writes its own row, and both rolls stand", state.list[0].rolled.state === "lair" && within(state.list[1].current, 2, 6) && state.list[1].rolled.total === state.list[1].current, state.list);
  const rowCards = await until(gm, P.cardIds, { groupId: band.id, since: sinceRows }, (ids) => ids.length === 2);
  check("two presses post two cards", rowCards.length === 2, rowCards.length);
  for (const id of rowCards) swept.push(gm.track(id, "ChatMessage"));

  section("a row dragged to the map");
  await run(gm, P.reset, { groupId: second.id });
  await run(gm, P.close, { actorId: second.id });
  await run(gm, P.open, { actorId: second.id });
  await run(gm, P.drop, { groupId: second.id, actorId: lined.id });
  await until(gm, P.view, { groupId: second.id }, (v) => v.stacks === 1);
  const [{ key: dragged }] = (await run(gm, P.state, { groupId: second.id })).list;
  await setCount(second.id, dragged, "current", 7);
  await setCount(second.id, dragged, "initial", 7);
  await until(gm, P.view, { groupId: second.id }, (v) => v.sizeInputs === 2);
  const countField = `[data-stack-key="${dragged}"] input.deploy-count`;
  const onMap = () => run(gm, P.bodies, { sceneId: scene.id, groupId: second.id });
  const drag = async (count, options) => {
    await run(gm, P.field, { groupId: second.id, selector: countField, value: count });
    const had = new Set((await onMap()).map((b) => b.uuid));
    const out = await run(gm, P.dragRow, { groupId: second.id, stackKey: dragged, ...options });
    const bodies = await until(gm, P.bodies, { sceneId: scene.id, groupId: second.id }, (b) => b.length === had.size + count);
    const fresh = (bodies ?? []).filter((b) => !had.has(b.uuid)).sort((a, b) => a.y - b.y || a.x - b.x);
    swept.push(...fresh.map((b) => gm.track(b.uuid, "Token")));
    return { ...out, fresh };
  };
  const row = await run(gm, P.row, { groupId: second.id, stackKey: dragged });
  note("row", row);
  check("a stack is one row: art, name, what it is, its count and its actions", row.art === ART && row.name === "QA Knot" && row.detail.includes("Unindividuated: 7") && row.deploy, row);
  check("every field on the row names itself", row.fields.length === 3 && row.fields.every(Boolean), row.fields);
  check("a seat that can place tokens has a grip, and it says what it does", row.draggable && row.tip === "ACKS-LIB.group.dragRow", row);
  const three = await drag(3, { at: { x: 630, y: 330 } });
  note("dragged", three);
  check("the grip carries the stack and the row's Count", three.carried?.stackKey === dragged && three.carried?.count === 3 && three.carried?.group === `Actor.${second.id}`, three.carried);
  check("the drop places that many bodies, unlinked", three.fresh.length === 3 && three.fresh.every((b) => !b.linked && !b.hidden), three.fresh);
  const [firstBody, nextBody] = three.fresh;
  check("the first stands on the square under the cursor", firstBody?.x % 100 === 0 && firstBody?.y % 100 === 0 && Math.abs(firstBody?.x + 50 - three.point.x) <= 50 && Math.abs(firstBody?.y + 50 - three.point.y) <= 50, { firstBody, point: three.point });
  check("the next stands beside it", nextBody?.x - firstBody?.x === 100 && nextBody?.y === firstBody?.y, { firstBody, nextBody });
  state = await run(gm, P.state, { groupId: second.id });
  check("the bodies go out on record and the count stands", state.list[0].deployed === 3 && state.list[0].current === 7, state.list[0]);
  const loose = await drag(1, { at: { x: 437, y: 533 }, shift: true });
  check("Shift places the body where the cursor is, off the grid", loose.fresh[0]?.x === loose.point.x - 50 && loose.fresh[0]?.y === loose.point.y - 50, { body: loose.fresh[0], point: loose.point });
  const unseen = await drag(1, { at: { x: 830, y: 530 }, alt: true });
  check("Alt places it hidden on a Judge's seat", unseen.fresh[0]?.hidden === true, unseen.fresh[0]);
  const before = (await onMap()).length;
  await run(gm, P.dragRow, { groupId: second.id, stackKey: dragged, at: { x: -9000, y: -9000 } });
  check("a drop off the map places nothing", (await onMap()).length === before && before === 5, before);
  await run(gm, P.press, { groupId: second.id, selector: "[data-action='recall']" });
  await until(gm, P.bodies, { sceneId: scene.id, groupId: second.id }, (b) => !b.length);
  const left = await onMap();
  check("Recall folds them back", !left.length, left.length);
  state = await until(gm, P.state, { groupId: second.id }, (s) => s.list[0].deployed === 0);
  check("and every body is resting on its record", state?.list[0].roster === 5 && state?.list[0].current === 7, state?.list[0]);
  const sheetOf = async (actorId) => `#${await gm.eval(`game.actors.get(${JSON.stringify(actorId)}).sheet.id`)}`;
  await gm.shot(path.join(logDir(), "group-encounter-nested.png"), await sheetOf(second.id)).catch((err) => console.log(`plate not taken: ${err?.message ?? err}`));
  await run(gm, P.field, { groupId: second.id, selector: countField, value: 2 });
  await run(gm, P.press, { groupId: second.id, selector: stackKey(dragged, "deploy") });
  const fromButton = await until(gm, P.bodies, { sceneId: scene.id, groupId: second.id }, (b) => b.length === 2);
  swept.push(...fromButton.map((b) => gm.track(b.uuid, "Token")));
  check("the row's Deploy takes the same Count", fromButton.length === 2, fromButton.length);
  await run(gm, P.press, { groupId: second.id, selector: "[data-action='recall']" });
  await until(gm, P.bodies, { sceneId: scene.id, groupId: second.id }, (b) => !b.length);

  section("the raised type size");
  await until(gm, P.view, { groupId: band.id }, (v) => v.reveal === "noun");
  await until(gm, P.view, { groupId: band.id }, (v) => v.stacks === 2);
  const plain = await run(gm, P.measure, { groupId: band.id });
  await run(gm, P.press, { groupId: band.id, selector: "[data-action='rollEncounter']" });
  await until(gm, P.dialogs, null, (d) => d.count === 1);
  const plainDialog = await run(gm, P.measureDialog);
  await run(gm, P.dismiss);
  const knob = await run(gm, P.setBase, { base: `${LARGEST_TYPE}px` });
  await run(gm, P.close, { actorId: band.id });
  await run(gm, P.open, { actorId: band.id });
  const large = await run(gm, P.measure, { groupId: band.id });
  await run(gm, P.press, { groupId: band.id, selector: "[data-action='rollEncounter']" });
  await until(gm, P.dialogs, null, (d) => d.count === 1);
  const largeDialog = await run(gm, P.measureDialog);
  await run(gm, P.dismiss);
  await run(gm, P.setWidth, { groupId: band.id, width: 340 });
  const narrow = await run(gm, P.measure, { groupId: band.id });
  await gm.shot(path.join(logDir(), "group-encounter-narrow.png"), await sheetOf(band.id)).catch((err) => console.log(`plate not taken: ${err?.message ?? err}`));
  await run(gm, P.setWidth, { groupId: band.id, width: 600 });
  await run(gm, P.setBase, { base: knob.before });
  await run(gm, P.close, { actorId: band.id });
  await run(gm, P.open, { actorId: band.id });
  note("measures", { plain, large, narrow, plainDialog, largeDialog });
  check("the knob reaches the Roll, the reveal, its line and a stack's note", ["roll", "reveal", "face", "note"].every((k) => large[k] > plain[k]), { plain, large });
  check("at the opening width and the default type a row's actions sit beside its grip", plain.oneLine === true, plain);
  check("and the band still fits", !large.overflow && large.clipped === 0, large);
  check("and at the narrowest window every control stays on it", narrow.width < 500 && !narrow.overflow && narrow.clipped === 0 && !narrow.oneLine, narrow);
  check("it reaches the dialog", largeDialog?.select > plainDialog?.select && largeDialog?.line > plainDialog?.line, { plainDialog, largeDialog });
  check("and the dialog scrolls where it must, with no sideways bleed", largeDialog?.scroll === "auto" && !largeDialog?.overflow, largeDialog);

  section("a family dropped on a sheet");
  await run(gm, P.reset, { groupId: second.id });
  await run(gm, P.drop, { groupId: second.id, actorId: family.id });
  const variant = await until(gm, P.dialogs, null, (d) => d.count === 1);
  note("variant", variant.list[0]);
  check("a family asks which variant", variant.count === 1 && variant.list[0].selects === 1, variant.list[0]?.title);
  await gm.shot(plate("group-encounter-variant.png"), ".acks-lib-group-dialog").catch((err) => console.log(`plate not taken: ${err?.message ?? err}`));
  await run(gm, P.answer, { values: { size: "large" } });
  state = await until(gm, P.state, { groupId: second.id }, (s) => s.list.length === 1);
  const generated = state.list[0]?.uuid;
  if (generated) swept.unshift(gm.track(generated, "Actor"));
  check("the stack is of the variant picked", state.list[0]?.label === "QA Large", state.list[0]);
  pressed = await roll(second.id, { context: "wilderness", state: "wandering" });
  state = await until(gm, P.state, { groupId: second.id }, (s) => s.list[0]?.rolled.total != null);
  check("and the generated creature's line rolls", state.list[0]?.formula === "2d3+1", state.list[0]);

  section("the line a scene opens on");
  const opening = async () => {
    await run(gm, P.press, { groupId: band.id, selector: "[data-action='rollEncounter']" });
    const shown = await until(gm, P.dialogs, null, (d) => d.count === 1);
    await run(gm, P.dismiss);
    return shown.list[0]?.context;
  };
  for (const [mapSystem, line] of [["delve", "dungeon"], ["journey", "wilderness"], ["settlement", "wilderness"]]) {
    await run(gm, P.setSystem, { sceneId: scene.id, mapSystem });
    check(`a scene declared ${mapSystem} opens the dialog on ${line}`, (await opening()) === line);
  }
  await run(gm, P.setSystem, { sceneId: scene.id, mapSystem: null });
  const parties = await run(gm, P.partyLines);
  note("kept parties on undeclared scenes", parties);
  check("a party's mode gives the line where its scene says nothing", parties.every(({ mode, line }) => line === ({ delve: "dungeon", journey: "wilderness" }[mode] ?? null)), parties.length);

  section("an unlinked token");
  await run(gm, P.reset, { groupId: unlinked.id });
  await run(gm, P.open, { actorId: unlinked.id });
  await run(gm, P.drop, { groupId: unlinked.id, actorId: lined.id });
  await until(gm, P.view, { groupId: unlinked.id }, (v) => v.stacks === 1);
  await run(gm, P.close, { actorId: unlinked.id });
  const token = await run(gm, P.place, { sceneId: scene.id, actorId: unlinked.id, x: 700 });
  await run(gm, P.openToken, { sceneId: scene.id, tokenId: token.id, key: "synthetic" });
  warned = await run(gm, P.warnCount);
  await run(gm, P.press, { groupId: "synthetic", selector: "[data-action='rollEncounter']" });
  warns = await until(gm, P.warnsAfter, warned, (w) => w.length > 0);
  check("a token's own copy refuses the Roll and says where to press it", warns[0]?.includes("Actors sidebar") && (await run(gm, P.dialogs)).count === 0, warns);
  await run(gm, P.close, { actorId: "synthetic" });

  section("plates");
  try {
    await run(gm, P.reset, { groupId: band.id });
    await run(gm, P.closeAll);
    const shot = await run(gm, P.monsterTool, { actorId: lined.id, press: true });
    swept.unshift(gm.track(shot.groupId, "Actor"));
    await until(gm, P.state, { groupId: shot.groupId }, (s) => s.list.length === 1);
    await run(gm, P.drop, { groupId: shot.groupId, actorId: units.id });
    await until(gm, P.view, { groupId: shot.groupId }, (v) => v.stacks === 2);
    const body = `#${await gm.eval(`game.actors.get(${JSON.stringify(shot.groupId)}).sheet.id`)}`;
    await gm.compose?.(body);
    await run(gm, P.press, { groupId: shot.groupId, selector: "[data-action='rollEncounter']" });
    await until(gm, P.dialogs, null, (d) => d.count === 1);
    await gm.shot(plate("group-encounter-dialog.png"), ".acks-lib-group-dialog");
    await run(gm, P.answer, { values: { context: "wilderness", state: "chance" } });
    const end = await until(gm, P.state, { groupId: shot.groupId }, (s) => s.list[0].rolled.total != null);
    const posted = await until(gm, P.card, { groupId: shot.groupId, since: 0 }, (c) => !!c);
    if (posted) swept.unshift(gm.track(posted.id, "ChatMessage"));
    await roll(shot.groupId, { context: "wilderness", state: "lair" }, end.list[1].key);
    await until(gm, P.state, { groupId: shot.groupId }, (s) => s.list[1].rolled.total != null);
    await until(gm, P.view, { groupId: shot.groupId }, (v) => v.rolls[1] === "Roll again");
    await gm.shot(plate("group-encounter-sheet.png"), body);
    if (posted && (await run(gm, P.showCard, { id: posted.id }))) await gm.shot(plate("group-encounter-card.png"), ".chat-popout .message-content");
    note("plates", { sized: end.list[0].current > 0 });
  } catch (err) { console.log(`plates not taken: ${err?.message ?? err}`); }

  section("errors after ready");
  for (const [key, api] of Object.entries(open)) {
    const boot = await run(api, P.boot);
    check(`${key} seat: nothing thrown over the walk`, !boot?.errors.length, boot?.errors);
  }
} catch (err) {
  console.log(`WALK ERROR: ${err?.message ?? err}`);
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  section("teardown");
  try { if (open.gm) await run(open.gm, P.closeAll); } catch (err) { console.error("close:", err?.message ?? err); }
  try { if (open.gm && swept.length) note("swept", await open.gm.sweepTracked({ only: swept })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
}
