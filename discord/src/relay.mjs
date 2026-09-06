/**
 * The world's public chat into one Discord channel.
 *
 * What travels: messages with no whisper list and no blind flag, and not
 * posted by this bot's own commands (those already answered their
 * interaction). Whispers and blind rolls stay in Foundry in this version;
 * routing them to the recipient's DM is on the roadmap, and so is one
 * channel per party.
 */
import { chatLine, relayable } from "./format.mjs";

export function attachRelay({ seat, client, config, log }) {
  const channelId = config.discord.chatChannelId;
  if (!channelId) {
    log.info("relay: DISCORD_CHAT_CHANNEL_ID unset; the world's chat stays in Foundry");
    return () => {};
  }
  let channel = null;
  const resolve = async () => {
    if (channel) return channel;
    const ch = await client.channels.fetch(channelId);
    if (!ch || !(ch.isSendable?.() ?? ch.isTextBased?.())) throw new Error(`relay: channel ${channelId} cannot be sent to`);
    channel = ch;
    return ch;
  };
  const onEvent = async (ev) => {
    if (!relayable(ev)) return;
    try {
      const ch = await resolve();
      await ch.send({ content: chatLine(ev), allowedMentions: { parse: [] } });
    } catch (err) {
      log.warn(`relay: ${err.message}`);
    }
  };
  seat.on("event", onEvent);
  return () => seat.off("event", onEvent);
}
