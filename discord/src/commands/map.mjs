import { SlashCommandBuilder, AttachmentBuilder } from "discord.js";

/**
 * Judge: a picture of the scene the party is on, as the seat sees it.
 *
 * The seat is an Assistant GM, so this is the Judge's view of the map —
 * every token, no fog. It is the Judge's to post, which is why it is a Judge
 * command; a player-vision map is on the roadmap.
 */
export default {
  data: new SlashCommandBuilder()
    .setName("map")
    .setDescription("Judge: post the party's map as the seat sees it")
    .addNumberOption((o) => o.setName("scale").setDescription("Zoom (1 = the scene's own size; 0.5 = half)").setRequired(false).setMinValue(0.1).setMaxValue(4))
    .addBooleanOption((o) => o.setName("private").setDescription("Only to you").setRequired(false)),

  async execute(interaction, ctx) {
    const isPrivate = interaction.options.getBoolean("private") === true;
    await interaction.deferReply(isPrivate ? { flags: 64 } : {});
    const scale = interaction.options.getNumber("scale");
    const view = await ctx.run("map", scale ? { scale } : {}, { timeout: 45000 });
    const png = await ctx.seat.screenshot(view.clip);
    const file = new AttachmentBuilder(png, { name: "map.png" });
    const caption = `**${view.scene?.name ?? "The map"}**${view.formation?.name ? ` — ${view.formation.name}` : ""}`;
    await interaction.editReply({ content: caption, files: [file] });
  },
};
