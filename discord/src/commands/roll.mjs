import { SlashCommandBuilder } from "discord.js";
import { rollChoice, rollText, diceText, looksLikeDice, clip, LIMITS } from "../format.mjs";

/**
 * Roll: one of the character's throws by its stable id, or any dice formula
 * for anyone — linked or not. A formula is told from a throw by its shape
 * (`2d6+3` has dice in it; `save:death` has a colon), so one command serves
 * the table's dice and the sheet's throws, and the reply is public because
 * a roll is for the table.
 */
export default {
  data: new SlashCommandBuilder()
    .setName("roll")
    .setDescription("Roll dice, or one of your character's throws")
    .addStringOption((o) => o.setName("what").setDescription("A formula like 2d6+3, or a throw — a save, a check, an attack, an ability").setRequired(true).setAutocomplete(true)),

  async autocomplete(interaction, ctx) {
    const query = String(interaction.options.getFocused() ?? "");
    if (looksLikeDice(query)) return [{ name: clip(`🎲 ${query.trim()}`, LIMITS.choice), value: clip(query.trim(), LIMITS.choice) }];
    try {
      const r = await ctx.run("rolls", { query, limit: 25 });
      return (r.rolls ?? []).map(rollChoice);
    } catch {
      // Unlinked, or no character chosen: dice still roll, so the picker stays quiet rather than wrong.
      return [];
    }
  },

  async execute(interaction, ctx) {
    await interaction.deferReply();
    const what = interaction.options.getString("what", true);
    if (looksLikeDice(what)) {
      const result = await ctx.run("dice", { formula: what });
      await interaction.editReply({ content: diceText(result, interaction.member?.displayName ?? interaction.user.displayName ?? interaction.user.username), allowedMentions: { parse: [] } });
      return;
    }
    const result = await ctx.run("roll", { id: what }, { timeout: 45000 });
    await interaction.editReply({ content: rollText(result) });
  },
};
