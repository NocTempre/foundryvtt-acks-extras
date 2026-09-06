/**
 * What Discord shows, as plain data: embeds are API-shaped objects (discord.js
 * accepts them as they are), text is a string. Nothing here touches the
 * network, so every shape is testable.
 *
 * Discord's limits are enforced here and nowhere else: a message body of
 * 2000, an embed description of 4096, a field value of 1024, 25 fields, an
 * autocomplete choice name of 100.
 */
export const LIMITS = Object.freeze({ content: 2000, description: 4096, field: 1024, fields: 25, choice: 100, title: 256 });

/** Cut to `max`, marking the cut. */
export function clip(text, max) {
  const s = String(text ?? "");
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

const signed = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

/** Why a bridge answer was refused, in the user's terms. */
export function refusalText(code, message = "") {
  switch (code) {
    case "unbound":
      return "You are not linked to a Foundry user yet — ask the Judge to `/link` you.";
    case "forbidden":
      return "That is not yours to do.";
    case "noActive":
      return "Choose a character first: `/character use`.";
    case "notFound":
      return `Not found${message ? `: ${message}` : "."}`;
    case "invalid":
      return `That will not work${message ? `: ${message}` : "."}`;
    case "unknownCommand":
      return "The world does not know that command — the module and the bot may be out of step.";
    case "seatDown":
      return "The Foundry seat is reconnecting; try again in a moment.";
    default:
      return `Foundry refused${message ? `: ${clip(message, 300)}` : "."}`;
  }
}

/** A character as a one-line label. */
export function characterLabel(c) {
  const bits = [c?.name ?? "?"];
  const cls = [c?.cls?.name ?? c?.cls, c?.level ?? c?.cls?.level].filter((v) => v !== null && v !== undefined && v !== "");
  if (cls.length) bits.push(`(${cls.join(" ")})`);
  return bits.join(" ");
}

/** `/whoami` as text. */
export function whoamiText(w) {
  if (!w?.bound) return "You are not linked to a Foundry user. Ask the Judge to `/link` you.";
  const lines = [`Linked to Foundry user **${w.user?.name ?? "?"}**${w.judge ? " (Judge)" : ""}.`];
  lines.push(w.active ? `Speaking as **${characterLabel(w.active)}**.` : "No active character — `/character use` to pick one.");
  if (w.characters?.length) lines.push(`Characters: ${w.characters.map((c) => c.name).join(", ")}${w.characters.length >= 25 ? "…" : ""}`);
  else lines.push("You own no characters yet.");
  return clip(lines.join("\n"), LIMITS.content);
}

/** `/sheet` as an embed. */
export function sheetEmbed(s) {
  const cls = s.cls && typeof s.cls === "object" ? s.cls : { name: s.cls, level: s.level };
  const title = clip([s.name, cls?.name ? `— ${cls.name}${cls.level ? ` ${cls.level}` : ""}` : ""].filter(Boolean).join(" "), LIMITS.title);
  const fields = [];
  const hp = s.hp ?? {};
  fields.push({ name: "HP", value: `${hp.value ?? "?"} / ${hp.max ?? "?"}`, inline: true });
  const ac = s.ac ?? {};
  fields.push({ name: "AC", value: `${ac.value ?? "?"}${ac.shield ? ` (${ac.value - ac.shield} without shield)` : ""}`, inline: true });
  if (s.xp) fields.push({ name: "XP", value: `${s.xp.value ?? 0}${s.xp.next ? ` / ${s.xp.next}` : ""}`, inline: true });
  if (typeof s.coinGp === "number") fields.push({ name: "Purse", value: `${Math.round(s.coinGp * 100) / 100} gp`, inline: true });
  if (s.move?.modes) {
    const m = s.move.modes;
    const parts = ["combat", "exploration", "expedition"].filter((k) => m[k] !== undefined).map((k) => `${k} ${m[k]}`);
    if (parts.length) fields.push({ name: "Movement", value: clip(parts.join(" · "), LIMITS.field), inline: false });
  }
  if (s.saves && typeof s.saves === "object") {
    const saves = Object.entries(s.saves)
      .map(([k, v]) => `${k} ${typeof v === "object" ? (v?.value ?? "?") : v}+`)
      .join(" · ");
    if (saves) fields.push({ name: "Saves", value: clip(saves, LIMITS.field), inline: false });
  }
  if (s.grip?.weapons?.length) fields.push({ name: "In hand", value: clip(s.grip.weapons.map((w) => `${w.name}${w.twoHanded ? " (two hands)" : ""}`).join(", "), LIMITS.field), inline: false });
  if (s.formation?.name) fields.push({ name: "Party", value: clip(String(s.formation.name), LIMITS.field), inline: true });
  if (s.pending) fields.push({ name: "Open picks", value: String(s.pending), inline: true });
  return { title, fields: fields.slice(0, LIMITS.fields) };
}

/** One autocomplete choice for a roll row. */
export function rollChoice(r) {
  const name = clip(`${r.label}${r.value ? ` ${r.value}` : ""} · ${r.group}`, LIMITS.choice);
  return { name, value: clip(r.id, LIMITS.choice) };
}

/** A chat event's one-line rendering (the relay and the roll reply share it). */
export function chatLine(ev) {
  const who = ev.speaker?.alias ?? "Someone";
  const rolls = (ev.rolls ?? []).filter((r) => r.total !== null && r.total !== undefined);
  if (rolls.length) {
    const dice = rolls.map((r) => `**${r.total}**${r.formula ? ` (${r.formula})` : ""}`).join(", ");
    return clip(`🎲 **${who}** ${ev.flavor ? `— ${ev.flavor}: ` : ""}${dice}${ev.text ? `\n${ev.text}` : ""}`, LIMITS.content);
  }
  const body = ev.text || ev.flavor || "";
  return clip(`**${who}**${ev.flavor && ev.text ? ` — ${ev.flavor}` : ""}: ${body}`, LIMITS.content);
}

/** `/roll` as text. */
export function rollText(result) {
  const msgs = result?.messages ?? [];
  if (!msgs.length) return `**${result?.actor?.name ?? "?"}** rolled \`${result?.id ?? "?"}\` — the card posted in Foundry carried nothing this bot can read.`;
  return clip(msgs.map(chatLine).join("\n"), LIMITS.content);
}

/** `/say` as text. */
export function sayText(result) {
  const name = result?.actor?.name ?? "?";
  return clip(result?.style === "emote" ? `*${name} ${result.text}*` : `**${name}:** ${result?.text ?? ""}`, LIMITS.content);
}

/** The relay's filter: public, and not something this bot already showed. */
export function relayable(ev) {
  if (ev?.type !== "chat") return false;
  if ((ev.whisper?.length ?? 0) > 0 || ev.blind) return false;
  if (ev.bridge?.via === "discord") return false;
  return !!(ev.text || ev.rolls?.length);
}
