import { SlashCommandBuilder } from "discord.js";
import { sayText } from "../format.mjs";

/** Post to the world's chat as your character; the reply is the channel's copy. */
export default {
  data: new SlashCommandBuilder()
    .setName("say")
    .setDescription("Speak as your character in the world's chat")
    .addStringOption((o) => o.setName("text").setDescription("What you say").setRequired(true).setMaxLength(2000))
    .addBooleanOption((o) => o.setName("emote").setDescription("An action rather than words").setRequired(false)),

  async execute(interaction, ctx) {
    await interaction.deferReply();
    const text = interaction.options.getString("text", true);
    const emote = interaction.options.getBoolean("emote") === true;
    const r = await ctx.run("say", { text, ...(emote ? { style: "emote" } : {}) });
    await interaction.editReply({ content: sayText(r) });
  },
};
