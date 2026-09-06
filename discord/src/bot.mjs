/**
 * The Discord client and its one router.
 *
 * Every chat command defers within Discord's three-second window before it
 * touches Foundry, then edits the reply; autocomplete answers straight from
 * the bridge, which is fast enough. A handler that throws gets its error
 * translated once, here, and the interaction is always answered — an
 * unanswered interaction shows the member a permanent "did not respond".
 *
 * Intents: Guilds only. Slash commands need no privileged intent; the day a
 * proxy prefix (`Ael: draws her sword`) lands, Message Content joins here.
 */
import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { makeContext, errorText } from "./context.mjs";

/**
 * @param {object} opts
 * @param {(member: {id: string, name: string, displayName: string}) => void} [opts.onMember]
 *   told of every member who runs a command, so the world can be shown who
 *   has knocked without a privileged intent
 */
export function createBot({ config, bridge, seat, log, commands, onMember }) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const byName = new Map(commands.map((c) => [c.data.name, c]));

  client.once(Events.ClientReady, (c) => log.info(`discord ready as ${c.user.tag}`));
  client.on(Events.Error, (err) => log.error("discord client error", err));
  client.on(Events.Warn, (msg) => log.warn(`discord: ${msg}`));

  client.on(Events.InteractionCreate, async (interaction) => {
    const cmd = byName.get(interaction.commandName);
    if (!cmd) return;
    const ctx = makeContext(interaction, { config, bridge, seat, log });
    if (interaction.isChatInputCommand()) {
      try {
        onMember?.({ id: interaction.user.id, name: interaction.user.username ?? "", displayName: interaction.member?.displayName ?? interaction.user.displayName ?? "" });
      } catch (err) {
        log.warn(`member ledger: ${err.message}`);
      }
    }

    if (interaction.isAutocomplete()) {
      try {
        const choices = (await cmd.autocomplete?.(interaction, ctx)) ?? [];
        await interaction.respond(choices.slice(0, 25));
      } catch (err) {
        log.warn(`autocomplete ${interaction.commandName}: ${err.message}`);
        await interaction.respond([]).catch(() => {});
      }
      return;
    }
    if (!interaction.isChatInputCommand()) return;

    const started = Date.now();
    try {
      await cmd.execute(interaction, ctx);
      log.info(`/${interaction.commandName} by ${interaction.user.id} in ${Date.now() - started}ms`);
    } catch (err) {
      const text = errorText(err);
      log.warn(`/${interaction.commandName} by ${interaction.user.id} failed: ${err.message}`);
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content: text, embeds: [], files: [] }).catch(() => {});
      else await interaction.reply({ content: text, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  });

  return {
    client,
    login: () => client.login(config.discord.token),
    stop: () => client.destroy(),
  };
}
