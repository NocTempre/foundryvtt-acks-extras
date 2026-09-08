/**
 * Whether a guild the bot just joined should become its configured server.
 * Pure: no Discord client, no Foundry, so a test drives it without either.
 *
 * A bot invited to a server while it already has one keeps what it has — a
 * second invite is the operator's to choose in Foundry, not the bot's to
 * grab. Only a bot with nothing chosen yet adopts the guild it just joined,
 * the same way it already adopts the one guild it finds itself in at login.
 */

/**
 * @param {{guildId?: string, judgeIds?: Iterable<string>}} discord  the running config's discord half
 * @param {{id: string, ownerId?: string}} guild                     the guild that fired GuildCreate
 * @returns {null | {guildId: string, judgeIds: Set<string>}}        fields to apply, or null when a guild is already chosen
 */
export function adoptGuild(discord, guild) {
  if (discord?.guildId) return null;
  const judgeIds = new Set(discord?.judgeIds ?? []);
  if (guild?.ownerId) judgeIds.add(guild.ownerId);
  return { guildId: guild?.id ?? "", judgeIds };
}
