import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { clip, LIMITS } from "../format.mjs";

/** Judge: which formation this channel speaks for. */
export default {
  data: new SlashCommandBuilder()
    .setName("party")
    .setDescription("Judge: the party this channel belongs to")
    .addSubcommand((s) => s.setName("show").setDescription("Which party this channel is bound to"))
    .addSubcommand((s) =>
      s
        .setName("bind")
        .setDescription("Bind this channel to a formation")
        .addStringOption((o) => o.setName("formation").setDescription("The formation").setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((s) => s.setName("unbind").setDescription("Drop this channel's party binding")),

  async autocomplete(interaction, ctx) {
    const q = String(interaction.options.getFocused() ?? "").toLowerCase();
    const list = await ctx.run("parties");
    return list
      .filter((f) => !q || String(f.name ?? "").toLowerCase().includes(q))
      .slice(0, 25)
      .map((f) => ({ name: clip(`${f.name ?? f.id}${f.members !== null ? ` (${f.members})` : ""}`, LIMITS.choice), value: clip(f.id, LIMITS.choice) }));
  },

  async execute(interaction, ctx) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();
    if (sub === "bind") {
      const r = await ctx.run("party", { formationId: interaction.options.getString("formation", true) });
      await interaction.editReply({ content: `This channel now speaks for **${r.formation?.name ?? r.formation?.id}**.` });
      return;
    }
    if (sub === "unbind") {
      await ctx.run("party", { unbind: true });
      await interaction.editReply({ content: "This channel speaks for no party." });
      return;
    }
    const r = await ctx.run("party");
    await interaction.editReply({ content: r.formation ? `This channel speaks for **${r.formation.name ?? r.formation.id}**.` : "This channel is bound to no party." });
  },
};
