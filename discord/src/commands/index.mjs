/**
 * Every slash command, in the order they register. A command is
 * `{ data: SlashCommandBuilder, execute(interaction, ctx), autocomplete?(interaction, ctx) }`.
 */
import whoami from "./whoami.mjs";
import link from "./link.mjs";
import character from "./character.mjs";
import sheet from "./sheet.mjs";
import roll from "./roll.mjs";
import say from "./say.mjs";
import party from "./party.mjs";
import map from "./map.mjs";
import account from "./account.mjs";

export const commands = [whoami, link, account, character, sheet, roll, say, party, map];
