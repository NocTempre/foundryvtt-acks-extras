/* global Hooks, game */
/**
 * The event tap: what a seat holder hears from the world.
 *
 * Hooks the bridge cares about are folded into one plain-JSON event stream —
 * chat, the vitals of an actor, the clock, the henchmen ledger, and the
 * client's own configuration being saved — kept in a
 * bounded buffer in the page and pushed, when a seat holder has installed the
 * global named `EMIT_BINDING`, as they happen. A seat that connects late or
 * reconnects calls `drain(lastSeq)` for what it missed; the buffer is the
 * page's, so a reload starts it over, which the seat's `seq` going backwards
 * tells it.
 *
 * Visibility travels WITH the event: `whisper` and `blind` are carried as the
 * message has them, so the client routes a secret rather than flattening it.
 *
 * Provenance: a chat message posted while a bridge command is running for
 * its speaker is the command's own output (core's rollers create their card
 * without awaiting it, so the create lands a beat after the command returns).
 * The tap marks such an event with the command's client stamp and writes the
 * same stamp onto the message, so a relay can tell a roll made from Discord
 * from one made at the table.
 */
import { MODULE_ID, BRIDGE_FLAG, EMIT_BINDING, EVENT_BUFFER, SETTING_CLIENT } from "./constants.mjs";
import { stampFor, provenanceOf } from "./provenance.mjs";
import { textOf } from "./text.mjs";
import { readClientConfig } from "./client-config.mjs";

const buffer = [];
let seq = 0;
/** actorId → client, for the command currently running on this seat. */
const inflight = new Map();

/** Mark a command in flight for an actor; returns the release. */
export function markInflight(actorId, client) {
  inflight.set(actorId, client ?? null);
  return () => inflight.delete(actorId);
}

/** Emit one event: buffer it, and push it to the seat holder when one listens. */
export function emit(type, payload = {}) {
  const event = { seq: ++seq, at: Date.now(), type, ...payload };
  buffer.push(event);
  if (buffer.length > EVENT_BUFFER) buffer.shift();
  const fn = globalThis[EMIT_BINDING];
  if (typeof fn === "function") {
    try {
      fn(JSON.stringify(event));
    } catch (err) {
      console.warn(`${MODULE_ID} | bridge event push failed`, err);
    }
  }
  return event;
}

/** Events after `since`, and the current head. */
export function drain(since = 0) {
  const n = Number(since) || 0;
  return { seq, events: buffer.filter((e) => e.seq > n) };
}

/** A chat message as an event. */
export function chatEvent(msg, userId = null) {
  const speaker = msg.speaker ?? {};
  const rolls = (msg.rolls ?? []).map((r) => ({
    formula: r.formula ?? null,
    total: r.total ?? null,
    dice: (r.dice ?? []).map((d) => ({ faces: d.faces ?? null, results: (d.results ?? []).map((x) => x.result) })),
  }));
  return {
    id: msg.id,
    userId: userId ?? msg.author?.id ?? msg.user?.id ?? null,
    speaker: { actor: speaker.actor ?? null, alias: speaker.alias ?? null, token: speaker.token ?? null, scene: speaker.scene ?? null },
    whisper: [...(msg.whisper ?? [])],
    blind: !!msg.blind,
    style: msg.style ?? null,
    flavor: msg.flavor ?? "",
    text: textOf(msg.content),
    rolls,
    bridge: provenanceOf(msg),
  };
}

/** Wire the hooks. Called once at `ready`, on every client; only a seat with the binding hears anything. */
export function registerEventTap() {
  Hooks.on("createChatMessage", (msg, options, userId) => {
    const event = chatEvent(msg, userId);
    const actorId = event.speaker.actor;
    if (actorId && inflight.has(actorId) && userId === game.user.id && !event.bridge) {
      const stamp = stampFor(inflight.get(actorId), { command: "roll" });
      if (stamp) {
        event.bridge = stamp;
        msg.update({ [`flags.${MODULE_ID}.${BRIDGE_FLAG}`]: stamp }).catch((err) => console.warn(`${MODULE_ID} | bridge stamp failed`, err));
      }
    }
    emit("chat", event);
  });

  Hooks.on("updateActor", (actor, changes, options, userId) => {
    const hp = changes?.system?.hp;
    const xp = changes?.system?.details?.xp;
    if (!hp && !xp) return;
    emit("actor", {
      id: actor.id,
      uuid: actor.uuid,
      name: actor.name,
      userId: userId ?? null,
      hp: { value: Number(actor.system?.hp?.value) || 0, max: Number(actor.system?.hp?.max) || 0 },
      xp: { value: Number(actor.system?.details?.xp?.value) || 0 },
      changed: { hp: !!hp, xp: !!xp },
      bridge: inflight.has(actor.id) ? stampFor(inflight.get(actor.id)) : null,
    });
  });

  Hooks.on("updateWorldTime", (worldTime, dt) => emit("time", { worldTime: Math.floor(worldTime), dt }));

  // The client's own configuration moved. A client hears this the moment a
  // Judge saves the window and decides for itself whether the change is one
  // it must restart for; without it the change waits for the next poll.
  Hooks.on("updateSetting", (setting) => {
    if (setting?.key !== `${MODULE_ID}.${SETTING_CLIENT}`) return;
    emit("config", { revision: Number(readClientConfig().revision) || 0 });
  });

  for (const hook of ["acksExtras.hired", "acksExtras.wagesMissed", "acksExtras.calamity", "acksExtras.rosterChanged"]) {
    Hooks.on(hook, (payload = {}) => {
      const name = (d) => d?.name ?? null;
      emit("henchmen", {
        hook,
        employer: name(payload.employer),
        actor: name(payload.actor),
        location: name(payload.location),
      });
    });
  }
}
