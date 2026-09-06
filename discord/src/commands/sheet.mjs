import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { sheetEmbed, characterLabel, clip, LIMITS } from "../format.mjs";

/** The frame of the active (or a named) character: vitals, saves, purse, hands. */
export default {
  data: new SlashCommandBuilder()
    .setName("sheet")
    .setDescription("Your character's vitals, saves, purse and hands")
    .addStringOption((o) => o.setName("character").setDescription("Another character you own (default: the one you speak as)").setRequired(false).setAutocomplete(true))
    .addBooleanOption((o) => o.setName("public").setDescription("Show it to the channel rather than only to you").setRequired(false)),

  async autocomplete(interaction, ctx) {
    const query = String(interaction.options.getFocused() ?? "");
    const list = await ctx.run("characters", { query, limit: 25 });
    return list.map((c) => ({ name: clip(characterLabel(c), LIMITS.choice), value: clip(c.uuid, LIMITS.choice) }));
  },

  async execute(interaction, ctx) {
    const isPublic = interaction.options.getBoolean("public") === true;
    await interaction.deferReply(isPublic ? {} : { flags: MessageFlags.Ephemeral });
    const uuid = interaction.options.getString("character");
    const s = await ctx.run("sheet", uuid ? { uuid } : {});
    await interaction.editReply({ embeds: [sheetEmbed(s)] });
  },
};
