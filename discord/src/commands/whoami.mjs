import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { whoamiText } from "../format.mjs";

/** Who am I in the world: the bound user, the active character, the rest. */
export default {
  data: new SlashCommandBuilder().setName("whoami").setDescription("Which Foundry user you are linked to, and who you are speaking as"),
  async execute(interaction, ctx) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const who = await ctx.run("whoami");
    await interaction.editReply({ content: whoamiText(who) });
  },
};
