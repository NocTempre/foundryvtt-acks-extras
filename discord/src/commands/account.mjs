import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { PASSWORD_MIN, PASSWORD_MAX } from "../../../scripts/bridge/accounts-logic.mjs";

/**
 * A Foundry account from Discord: the Judge makes one for a member, and a
 * member sets their own password.
 *
 * The password arrives as a slash option, which Discord carries like any
 * other and this bot never logs. It goes from here to the seat on the same
 * machine and from the seat to Foundry as the join screen would send it.
 */
export default {
  data: new SlashCommandBuilder()
    .setName("account")
    .setDescription("Your Foundry account")
    .addSubcommand((s) =>
      s
        .setName("create")
        .setDescription("Judge: make a Foundry user for a member and link them")
        .addUserOption((o) => o.setName("member").setDescription("The Discord member").setRequired(true))
        .addStringOption((o) => o.setName("name").setDescription("The Foundry user's name (default: the member's name here)").setRequired(false).setMaxLength(64)),
    )
    .addSubcommand((s) =>
      s
        .setName("password")
        .setDescription("Set your own Foundry password")
        .addStringOption((o) => o.setName("new").setDescription(`Your new password, ${PASSWORD_MIN} to ${PASSWORD_MAX} characters`).setRequired(true).setMinLength(PASSWORD_MIN).setMaxLength(PASSWORD_MAX)),
    ),

  async execute(interaction, ctx) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();
    if (sub === "create") {
      const member = interaction.options.getUser("member", true);
      const asMember = interaction.options.getMember("member");
      const name = interaction.options.getString("name") ?? asMember?.displayName ?? member.displayName ?? member.username;
      const r = await ctx.run("enroll", { externalId: member.id, name });
      await interaction.editReply({ content: `Created Foundry user **${r.user.name}** (a Player) and linked <@${member.id}> to it.\nThey set their own password with \`/account password\`; until they do, nobody can join as that user.` });
      return;
    }
    const password = interaction.options.getString("new", true);
    const r = await ctx.run("password", { password });
    await interaction.editReply({ content: `Your Foundry password is set for user **${r.user.name}**. Any Foundry session you had open has been signed out.` });
  },
};
