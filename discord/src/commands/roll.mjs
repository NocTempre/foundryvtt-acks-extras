import { SlashCommandBuilder } from "discord.js";
import { rollChoice, rollText } from "../format.mjs";

/** Make one of the throws the sheet lists, by its stable id. */
export default {
  data: new SlashCommandBuilder()
    .setName("roll")
    .setDescription("Make one of your character's throws")
    .addStringOption((o) => o.setName("what").setDescription("Which throw — a save, a check, an attack, an ability").setRequired(true).setAutocomplete(true)),

  async autocomplete(interaction, ctx) {
    const query = String(interaction.options.getFocused() ?? "");
    const r = await ctx.run("rolls", { query, limit: 25 });
    return (r.rolls ?? []).map(rollChoice);
  },

  async execute(interaction, ctx) {
    await interaction.deferReply();
    const id = interaction.options.getString("what", true);
    const result = await ctx.run("roll", { id }, { timeout: 45000 });
    await interaction.editReply({ content: rollText(result) });
  },
};
