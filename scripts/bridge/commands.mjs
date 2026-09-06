/* global game, fromUuidSync, ChatMessage, Hooks, canvas, CONST, foundry, document */
/**
 * The v1 verbs. Each is a permission guard over a function another feature
 * already owns; none knows a rule and none renders.
 *
 *   whoami · characters · use · sheet · rolls · roll · say      — a bound user
 *   link · unlink · bindings · users · parties · party · map    — a Judge
 *   events · commands                                           — anyone
 *
 * Every actor a command touches is resolved through `actorFor`: the uuid
 * named, else the user's active character, and then `requireOwner` as the
 * BOUND user — the seat's own Assistant GM rights never decide anything.
 *
 * `roll` is the one command whose output is not its return value: core's
 * rollers post their card without awaiting the create, so the card lands a
 * beat after the roll resolves. The command marks the actor in flight for
 * the event tap, collects the messages this client creates for that speaker
 * while it runs, and waits a short settle for the last one.
 */
import { ERR } from "./constants.mjs";
import { BridgeError, requireOwner } from "./registry-logic.mjs";
import { readStore, writeStore } from "./bindings.mjs";
import { bindUser, unbindUser, setActive, activeOf, bindParty, unbindParty, partyOf, externalIdsOf } from "./bindings-logic.mjs";
import { markInflight, drain, chatEvent } from "./events.mjs";
import { flagsFor } from "./provenance.mjs";
import { rollInventory, rollById } from "../character-sheet/rolls.mjs";
import { snapshotFrame } from "../character-sheet/snapshot.mjs";
import { coinTotalGC } from "../lib/storage-logic.mjs";
import { ACTOR_TYPE, ITEM_TYPE } from "../lib/vocab.mjs";

/** The autocomplete cap a client can show at once; `characters` and `rolls` list past it only on request. */
const LIST_CAP = 25;
const LIST_MAX = 100;
/** How long `roll` waits for a card after the roll resolves. */
const SETTLE_AFTER_FIRST_MS = 250;
const SETTLE_MAX_MS = 1500;
const SAY_MAX = 2000;

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const str = (v, what) => {
  const s = String(v ?? "").trim();
  if (!s) throw new BridgeError(ERR.invalid, `${what} is required`);
  return s;
};
const formationApi = () => globalThis.acksExtras?.formation ?? null;

/** A user as a client sees it. */
const userInfo = (u) => (u ? { id: u.id, name: u.name, role: u.role ?? null, isGM: !!u.isGM, active: !!u.active } : null);

/** An actor as a client sees it in a list. */
const brief = (a) => ({
  uuid: a.uuid,
  id: a.id,
  name: a.name,
  type: a.type,
  img: a.img ?? null,
  level: num(a.system?.details?.level, 0) || null,
  cls: String(a.system?.details?.class ?? ""),
});

/**
 * A JSON-safe copy: primitives, arrays and plain objects to a depth; a
 * Document becomes its id and name; anything else is dropped. The frame
 * snapshot mixes model data with document references, and a client gets the
 * data.
 */
function plain(value, depth = 4) {
  if (value == null) return value;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return value;
  if (t !== "object" || depth <= 0) return undefined;
  if (typeof value.documentName === "string") return { id: value.id ?? null, name: value.name ?? null };
  if (Array.isArray(value)) return value.map((v) => plain(v, depth - 1)).filter((v) => v !== undefined);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return { id: value.id ?? null, name: value.name ?? null };
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const p = plain(v, depth - 1);
    if (p !== undefined) out[k] = p;
  }
  return out;
}

/** The synthetic event that makes core's rollers skip their dialog. */
function skipEvent() {
  let key = "shiftKey";
  try {
    key = game.settings.get("acks", "skip-dialog-key") || key;
  } catch {
    /* the setting is core's; without it Shift is core's own default */
  }
  return { [key]: true, shiftKey: key === "shiftKey" };
}

function findActor(args) {
  const uuid = str(args.uuid, "actor uuid");
  const doc = fromUuidSync(uuid);
  if (!doc || doc.documentName !== "Actor") throw new BridgeError(ERR.notFound, `no actor at ${uuid}`);
  return doc;
}

/** The actor a command acts on, owned by the bound user. */
function actorFor(ctx, args) {
  let actor = null;
  if (args.uuid) actor = findActor(args);
  else {
    const uuid = activeOf(readStore(), ctx.user.id);
    actor = uuid ? fromUuidSync(uuid) : null;
    if (uuid && (!actor || actor.documentName !== "Actor")) throw new BridgeError(ERR.noActive, "the character you were using is gone — choose another");
    if (!actor) throw new BridgeError(ERR.noActive, "choose a character first");
  }
  return requireOwner(ctx, actor, actor.name);
}

function ownedCharacters(user, { query = "", limit = LIST_CAP } = {}) {
  const q = String(query ?? "").trim().toLowerCase();
  const cap = Math.min(LIST_MAX, Math.max(1, num(limit, LIST_CAP)));
  return game.actors
    .filter((a) => a.type === ACTOR_TYPE.character && a.testUserPermission(user, "OWNER"))
    .filter((a) => !q || a.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, cap);
}

function findUser({ foundryUserId, foundryUserName }) {
  const id = String(foundryUserId ?? "").trim();
  const name = String(foundryUserName ?? "").trim().toLowerCase();
  const user = (id && game.users.get(id)) || (name && game.users.find((u) => u.name.toLowerCase() === name)) || null;
  if (!user) throw new BridgeError(ERR.notFound, `no Foundry user ${id || foundryUserName}`);
  return user;
}

function activeActor(user, store = readStore()) {
  const uuid = activeOf(store, user.id);
  const doc = uuid ? fromUuidSync(uuid) : null;
  return doc && doc.documentName === "Actor" ? doc : null;
}

/** What `/sheet` shows: the frame snapshot the sheet itself reads, plus the purse. */
function summary(actor) {
  const coinGp = coinTotalGC(actor.items.filter((i) => i.type === ITEM_TYPE.money).map((i) => i.toObject()));
  let snap = null;
  try {
    snap = actor.type === ACTOR_TYPE.character ? plain(snapshotFrame(actor)) : null;
  } catch (err) {
    console.warn(`${actor.name}: frame snapshot failed, answering the basics`, err);
  }
  const sys = actor.system ?? {};
  return {
    ...brief(actor),
    hp: { value: num(sys.hp?.value), max: num(sys.hp?.max) },
    ac: { value: num(sys.aac?.value), shield: num(sys.aac?.shield), naked: num(sys.aac?.naked) },
    saves: plain(sys.saves) ?? {},
    coinGp,
    ...(snap ?? {}),
  };
}

function flattenInventory(inventory) {
  const out = [];
  for (const g of inventory?.groups ?? []) {
    for (const r of g.rows ?? []) {
      if (r.rollable === false) continue;
      out.push({ id: r.id, label: String(r.label ?? ""), value: String(r.value ?? ""), line: String(r.line ?? ""), group: String(g.name ?? ""), groupKey: g.key ?? null, pinned: !!r.pinned });
    }
  }
  return out;
}

const settle = (got) =>
  new Promise((resolve) => {
    const start = Date.now();
    const t = setInterval(() => {
      const elapsed = Date.now() - start;
      if ((got.length && elapsed >= SETTLE_AFTER_FIRST_MS) || elapsed >= SETTLE_MAX_MS) {
        clearInterval(t);
        resolve();
      }
    }, 50);
  });

/** Run `fn` and collect the chat messages this client posts for `actor` meanwhile. */
async function captureMessages(actor, client, fn) {
  const got = [];
  const hookId = Hooks.on("createChatMessage", (msg, options, userId) => {
    if (userId !== game.user.id) return;
    const sp = msg.speaker ?? {};
    if (sp.actor === actor.id || (sp.alias && sp.alias === actor.name)) got.push(msg);
  });
  const release = markInflight(actor.id, client);
  try {
    const result = await fn();
    await settle(got);
    return { result, messages: got };
  } finally {
    Hooks.off("createChatMessage", hookId);
    release();
  }
}

function formationsList() {
  const all = formationApi()?.getFormations?.() ?? [];
  const list = Array.isArray(all) ? all : Object.values(all ?? {});
  return list.map((f) => ({ id: f.id, name: f.name, sceneId: f.sceneId ?? null, tokenId: f.tokenId ?? null, members: Array.isArray(f.members) ? f.members.length : null }));
}

/**
 * A formation record by id, whichever shape the formation api answers: a
 * singular getter if it has one, else the map or list behind `getFormations`.
 * Null for an unknown id; never throws.
 */
function formationById(id) {
  const api = formationApi();
  if (!api || !id) return null;
  const direct = api.getFormation?.(id);
  if (direct) return direct;
  const all = api.getFormations?.() ?? null;
  if (!all) return null;
  if (Array.isArray(all)) return all.find((f) => f?.id === id) ?? null;
  return all[id] ?? Object.values(all).find((f) => f?.id === id) ?? null;
}

function findFormation(id) {
  const f = formationById(str(id, "formation id"));
  if (!f) throw new BridgeError(ERR.notFound, `no formation ${id}`);
  return f;
}

/** Register the v1 verbs on a registry. */
export function registerCommands(registry) {
  registry.register("commands", {
    allowUnbound: true,
    describe: "every command, without handlers",
    run: () => registry.list(),
  });

  registry.register("events", {
    allowUnbound: true,
    describe: "events after a sequence number",
    run: (ctx, args) => drain(args.since),
  });

  registry.register("whoami", {
    allowUnbound: true,
    describe: "who this identity is bound to, what it is speaking as",
    run: (ctx) => {
      if (!ctx.user) return { bound: false };
      const store = readStore();
      const active = activeActor(ctx.user, store);
      return {
        bound: true,
        user: userInfo(ctx.user),
        judge: ctx.judge,
        identities: externalIdsOf(store, ctx.user.id),
        active: active ? brief(active) : null,
        characters: ownedCharacters(ctx.user).map(brief),
      };
    },
  });

  registry.register("characters", {
    describe: "the characters the bound user owns, by name fragment",
    run: (ctx, args) => ownedCharacters(ctx.user, args).map(brief),
  });

  registry.register("use", {
    describe: "speak as this character from now on",
    run: async (ctx, args) => {
      const actor = requireOwner(ctx, findActor(args), "that character");
      await writeStore(setActive(readStore(), ctx.user.id, actor.uuid));
      return brief(actor);
    },
  });

  registry.register("sheet", {
    describe: "the frame of the active (or named) character",
    run: (ctx, args) => summary(actorFor(ctx, args)),
  });

  registry.register("rolls", {
    describe: "every throw the character can make, with its stable id",
    run: (ctx, args) => {
      const actor = actorFor(ctx, args);
      const q = String(args.query ?? "").trim().toLowerCase();
      const rolls = flattenInventory(rollInventory(actor)).filter((r) => !q || r.label.toLowerCase().includes(q) || r.id.includes(q) || r.group.toLowerCase().includes(q));
      const cap = Math.min(LIST_MAX, Math.max(1, num(args.limit, LIST_MAX)));
      return { actor: brief(actor), rolls: rolls.slice(0, cap) };
    },
  });

  registry.register("roll", {
    describe: "make one throw by id; answers the cards it posted",
    run: async (ctx, args) => {
      const actor = actorFor(ctx, args);
      const id = str(args.id, "roll id");
      // The inventory is the vocabulary: an id it does not list is refused
      // here, because core throws on a save or throw it has never heard of.
      if (!flattenInventory(rollInventory(actor)).some((r) => r.id === id)) throw new BridgeError(ERR.notFound, `nothing on ${actor.name} is called "${id}"`);
      const { result, messages } = await captureMessages(actor, ctx.client, () => rollById(actor, id, { event: skipEvent() }));
      if (result === false) throw new BridgeError(ERR.notFound, `nothing on ${actor.name} is called "${id}"`);
      return { actor: brief(actor), id, messages: messages.map((m) => chatEvent(m, game.user.id)) };
    },
  });

  registry.register("say", {
    describe: "post to chat as the character",
    run: async (ctx, args) => {
      const text = String(args.text ?? "").trim();
      if (!text) throw new BridgeError(ERR.invalid, "nothing to say");
      if (text.length > SAY_MAX) throw new BridgeError(ERR.invalid, `at most ${SAY_MAX} characters`);
      const actor = actorFor(ctx, args);
      const scene = canvas?.scene ?? game.scenes?.active ?? null;
      const token = scene?.tokens?.find?.((t) => t.actorId === actor.id) ?? null;
      const styles = CONST.CHAT_MESSAGE_STYLES ?? {};
      const style = args.style === "emote" ? styles.EMOTE : styles.IC;
      const data = {
        content: foundry.utils.escapeHTML(text),
        speaker: { actor: actor.id, alias: actor.name, scene: scene?.id ?? null, token: token?.id ?? null },
        flags: flagsFor(ctx.client, { command: "say" }),
      };
      if (style !== undefined) data.style = style;
      const msg = await ChatMessage.create(data);
      return { id: msg?.id ?? null, actor: brief(actor), text, style: args.style === "emote" ? "emote" : "ic" };
    },
  });

  registry.register("users", {
    judge: true,
    describe: "the world's users, for binding",
    run: () => game.users.map(userInfo).sort((a, b) => a.name.localeCompare(b.name)),
  });

  registry.register("link", {
    judge: true,
    describe: "bind a client identity to a Foundry user",
    run: async (ctx, args) => {
      const kind = str(args.kind ?? ctx.client?.kind, "client kind");
      const externalId = str(args.externalId, "external id");
      const user = findUser(args);
      const store = await writeStore(bindUser(readStore(), kind, externalId, user.id));
      return { kind, externalId, user: userInfo(user), identities: externalIdsOf(store, user.id) };
    },
  });

  registry.register("unlink", {
    judge: true,
    describe: "drop a client identity's binding",
    run: async (ctx, args) => {
      const kind = str(args.kind ?? ctx.client?.kind, "client kind");
      const externalId = str(args.externalId, "external id");
      await writeStore(unbindUser(readStore(), kind, externalId));
      return { kind, externalId, bound: false };
    },
  });

  registry.register("bindings", {
    judge: true,
    describe: "the whole binding store, resolved",
    run: () => {
      const s = readStore();
      return {
        users: Object.entries(s.users).map(([key, uid]) => ({ key, user: userInfo(game.users.get(uid)) ?? { id: uid, name: null } })),
        parties: Object.entries(s.parties).map(([key, fid]) => ({ key, formation: { id: fid, name: formationById(fid)?.name ?? null } })),
        active: Object.entries(s.active).map(([uid, uuid]) => {
          const a = fromUuidSync(uuid);
          return { user: userInfo(game.users.get(uid)) ?? { id: uid, name: null }, actor: a ? brief(a) : { uuid, name: null } };
        }),
      };
    },
  });

  registry.register("parties", {
    judge: true,
    describe: "every formation, for binding a channel to one",
    run: () => formationsList(),
  });

  registry.register("party", {
    judge: true,
    describe: "read, bind or unbind the party a channel speaks for",
    run: async (ctx, args) => {
      const kind = str(args.kind ?? ctx.client?.kind, "client kind");
      const channel = str(args.channel ?? ctx.client?.channel, "channel id");
      if (args.unbind) {
        await writeStore(unbindParty(readStore(), kind, channel));
        return { kind, channel, formation: null };
      }
      if (args.formationId) {
        const f = findFormation(args.formationId);
        await writeStore(bindParty(readStore(), kind, channel, f.id));
        return { kind, channel, formation: { id: f.id, name: f.name } };
      }
      const fid = partyOf(readStore(), kind, channel);
      const f = formationById(fid);
      return { kind, channel, formation: f ? { id: f.id, name: f.name } : fid ? { id: fid, name: null } : null };
    },
  });

  registry.register("map", {
    judge: true,
    describe: "view the party's scene on the seat and answer the board's clip for a capture",
    run: async (ctx, args) => {
      let formation = null;
      const fid = args.formationId ?? (ctx.client?.channel ? partyOf(readStore(), ctx.client.kind, ctx.client.channel) : null);
      if (fid) formation = formationById(fid);
      if (formation?.sceneId && formation.sceneId !== canvas?.scene?.id) {
        const scene = game.scenes.get(formation.sceneId);
        if (scene) await scene.view();
      }
      if (!canvas?.ready || !canvas.scene) throw new BridgeError(ERR.failed, "the seat has no scene ready");
      const scene = canvas.scene;
      let focus = null;
      const tok = formation?.tokenId ? scene.tokens.get(formation.tokenId) : null;
      if (tok) {
        const w = num(tok.width, 1) * scene.grid.size;
        const h = num(tok.height, 1) * scene.grid.size;
        focus = { x: tok.x + w / 2, y: tok.y + h / 2 };
      }
      if (Number.isFinite(Number(args.x)) && Number.isFinite(Number(args.y))) focus = { x: Number(args.x), y: Number(args.y) };
      const scale = Number.isFinite(Number(args.scale)) && Number(args.scale) > 0 ? Number(args.scale) : null;
      if (focus || scale) await canvas.animatePan({ ...(focus ?? {}), ...(scale ? { scale } : {}), duration: 0 });
      const r = document.getElementById("board")?.getBoundingClientRect();
      if (!r || r.width < 2 || r.height < 2) throw new BridgeError(ERR.failed, "the board has no area on the seat");
      return {
        scene: { id: scene.id, name: scene.name },
        formation: formation ? { id: formation.id, name: formation.name } : null,
        focus,
        scale: canvas.stage?.scale?.x ?? null,
        clip: { x: Math.max(0, Math.floor(r.x)), y: Math.max(0, Math.floor(r.y)), width: Math.ceil(r.width), height: Math.ceil(r.height) },
      };
    },
  });
}
