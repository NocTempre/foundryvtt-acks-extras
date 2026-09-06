import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { clip, LIMITS } from "../format.mjs";

/** Judge: bind a member to a Foundry user by name, or drop the binding. */
export default {
  data: new SlashCommandBuilder()
    .setName("link")
    .setDescription("Judge: bind a Discord member to a Foundry user")
    .addSubcommand((s) =>
      s
        .setName("set")
        .setDescription("Bind a member to a Foundry user")
        .addUserOption((o) => o.setName("member").setDescription("The Discord member").setRequired(true))
        .addStringOption((o) => o.setName("foundry").setDescription("The Foundry user's name").setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("drop")
        .setDescription("Drop a member's binding")
        .addUserOption((o) => o.setName("member").setDescription("The Discord member").setRequired(true)),
    )
    .addSubcommand((s) => s.setName("list").setDescription("Every binding the world holds")),

  async autocomplete(interaction, ctx) {
    const q = String(interaction.options.getFocused() ?? "").toLowerCase();
    const users = await ctx.run("users");
    return users
      .filter((u) => !q || u.name.toLowerCase().includes(q))
      .slice(0, 25)
      .map((u) => ({ name: clip(`${u.name}${u.isGM ? " (GM)" : ""}`, LIMITS.choice), value: clip(u.name, LIMITS.choice) }));
  },

  async execute(interaction, ctx) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();
    if (sub === "set") {
      const member = interaction.options.getUser("member", true);
      const foundryUserName = interaction.options.getString("foundry", true);
      const r = await ctx.run("link", { externalId: member.id, foundryUserName });
      await interaction.editReply({ content: `Linked <@${member.id}> to Foundry user **${r.user.name}**${r.user.isGM ? " (GM)" : ""}.` });
      return;
    }
    if (sub === "drop") {
      const member = interaction.options.getUser("member", true);
      await ctx.run("unlink", { externalId: member.id });
      await interaction.editReply({ content: `Dropped <@${member.id}>'s binding.` });
      return;
    }
    const b = await ctx.run("bindings");
    const lines = [];
    for (const u of b.users ?? []) lines.push(`• \`${u.key}\` → **${u.user?.name ?? u.user?.id ?? "?"}**`);
    for (const p of b.parties ?? []) lines.push(`• channel \`${p.key}\` → party **${p.formation?.name ?? p.formation?.id ?? "?"}**`);
    for (const a of b.active ?? []) lines.push(`• **${a.user?.name ?? "?"}** speaks as **${a.actor?.name ?? a.actor?.uuid ?? "?"}**`);
    await interaction.editReply({ content: clip(lines.length ? lines.join("\n") : "No bindings yet.", LIMITS.content) });
  },
};
