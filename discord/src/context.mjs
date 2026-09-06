/**
 * What every command handler gets beside the interaction: the client
 * identity the bridge stamps on its writes, whether the operator lists this
 * member as a Judge, and `run` — the bridge call with that identity attached.
 *
 * `asSeat` is set only for a Judge command from an operator-listed member:
 * the bridge then runs it as the seat's own user, which is how the first
 * Judge gets linked before any binding exists. Everything else runs as the
 * bound Foundry user, and the bridge's guard decides.
 */
import { JUDGE_COMMANDS } from "./config.mjs";
import { BridgeRefusal, Bridge } from "./bridge.mjs";
import { refusalText } from "./format.mjs";

const KIND = "discord";

export function makeContext(interaction, { config, bridge, seat, log }) {
  const client = {
    kind: KIND,
    user: interaction.user.id,
    guild: interaction.guildId ?? null,
    channel: interaction.channelId ?? null,
    message: interaction.id,
  };
  const judge = config.discord.judgeIds.has(interaction.user.id);
  return {
    client,
    judge,
    seat,
    log,
    config,
    /** Run a bridge command as this member. */
    run: (name, args = {}, options) => bridge.run(name, { client, ...(judge && JUDGE_COMMANDS.includes(name) ? { asSeat: true } : {}), ...args }, options),
  };
}

/** The user-facing text for anything a handler threw. */
export function errorText(err) {
  if (err instanceof BridgeRefusal) return refusalText(err.code, err.message);
  if (Bridge.isSeatDown(err)) return refusalText("seatDown");
  if (/^timeout:/.test(err?.message ?? "")) return "Foundry took too long to answer; try again.";
  return refusalText("failed", err?.message ?? String(err));
}
