import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { characterLabel, clip, LIMITS } from "../format.mjs";

/** List the characters you own, or choose the one you speak as. */
export default {
  data: new SlashCommandBuilder()
    .setName("character")
    .setDescription("Your characters")
    .addSubcommand((s) =>
      s
        .setName("list")
        .setDescription("The characters you own")
        .addStringOption((o) => o.setName("query").setDescription("Part of a name").setRequired(false)),
    )
    .addSubcommand((s) =>
      s
        .setName("use")
        .setDescription("Speak and roll as this character from now on")
        .addStringOption((o) => o.setName("name").setDescription("The character").setRequired(true).setAutocomplete(true)),
    ),

  async autocomplete(interaction, ctx) {
    const query = String(interaction.options.getFocused() ?? "");
    const list = await ctx.run("characters", { query, limit: 25 });
    return list.map((c) => ({ name: clip(characterLabel(c), LIMITS.choice), value: clip(c.uuid, LIMITS.choice) }));
  },

  async execute(interaction, ctx) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();
    if (sub === "use") {
      const c = await ctx.run("use", { uuid: interaction.options.getString("name", true) });
      await interaction.editReply({ content: `You now speak as **${characterLabel(c)}**.` });
      return;
    }
    const list = await ctx.run("characters", { query: interaction.options.getString("query") ?? "", limit: 100 });
    if (!list.length) {
      await interaction.editReply({ content: "You own no characters yet." });
      return;
    }
    await interaction.editReply({ content: clip(list.map((c) => `• ${characterLabel(c)}`).join("\n"), LIMITS.content) });
  },
};
