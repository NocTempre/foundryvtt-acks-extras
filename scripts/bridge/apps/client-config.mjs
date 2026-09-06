/* global game, ui, foundry */
/**
 * BridgeClientConfigApp — the Judge's window for the Discord bot: the server
 * it answers on, the channel the world's chat reaches, who may run a Judge
 * command before anyone is linked, how its seat is sized, and its token.
 *
 * The window talks to a bot it cannot call. Everything it shows of the bot —
 * whether one is running, which servers and channels it reaches, the key a
 * token must be sealed to — comes from the announcement the bot writes into
 * the world; everything it sets reaches the bot the same way back. So the
 * form renders dropdowns when the bot has announced a catalogue and plain
 * fields when it has not, and a token can only be set once a key has arrived.
 *
 * The token is sealed to that key before it is stored (`sealing.mjs`) and is
 * never read back: a window that could show it would be a window a player's
 * console could ask for the same value from.
 */
import { MODULE_ID, LANG } from "../constants.mjs";
import { readClientConfig, readAgent, writeClientConfig } from "../client-config.mjs";
import { LOG_LEVELS, configGaps, isCurrent, channelsOfGuild } from "../client-config-logic.mjs";
import { seal, keyIdOf, hintOf } from "../sealing.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/** How long an announcement stays fresh enough to call the bot present — over twice its heartbeat, so a running bot never flickers. */
const SEEN_FRESH_MS = 25 * 60 * 1000;

export class BridgeClientConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "acks-extras-bridge-client",
    tag: "form",
    classes: ["acks-ui", "acks-extras", "acks-extras-bridge-config", "acks-extras-scroll"],
    position: { width: 560, height: "auto" },
    window: { resizable: true, icon: "fab fa-discord" },
    form: { handler: BridgeClientConfigApp.#onSubmit, closeOnSubmit: false },
    actions: {
      refresh: BridgeClientConfigApp.#onRefresh,
      clearToken: BridgeClientConfigApp.#onClearToken,
    },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/bridge/client-config.hbs` },
  };

  get title() {
    return game.i18n.localize(`${LANG}.config.title`);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const config = readClientConfig();
    const agent = readAgent();
    const guildId = config.discord.guildId || agent.guilds[0]?.id || "";
    const channels = channelsOfGuild(agent, guildId);
    const fresh = agent.seenAt > 0 && Date.now() - agent.seenAt < SEEN_FRESH_MS;

    context.config = config;
    context.agent = agent;
    context.logLevels = LOG_LEVELS.map((value) => ({ value, label: value, selected: value === config.service.logLevel }));
    context.guilds = agent.guilds.map((g) => ({ ...g, selected: g.id === guildId }));
    context.channels = channels.map((c) => ({ ...c, selected: c.id === config.discord.chatChannelId }));
    context.hasGuilds = context.guilds.length > 0;
    context.hasChannels = context.channels.length > 0;
    context.judgeIds = config.discord.judgeIds.join(", ");
    context.canSeal = !!agent.publicKey;
    context.hasToken = !!config.token.sealed;
    context.tokenHint = config.token.hint;
    context.state = {
      code: agent.status.state,
      label: game.i18n.localize(`${LANG}.config.state.${agent.status.state}`),
      message: agent.status.message,
      fresh,
      seen: agent.seenAt ? new Date(agent.seenAt).toLocaleString() : "",
      version: agent.version,
      application: agent.application.name || agent.application.id,
      current: isCurrent(config, agent),
    };
    context.gaps = configGaps(config, agent).map((code) => ({ code, text: game.i18n.localize(`${LANG}.config.gap.${code}`) }));
    return context;
  }

  static #onRefresh() {
    this.render();
  }

  static async #onClearToken() {
    const config = readClientConfig();
    if (!config.token.sealed) return;
    await writeClientConfig({ ...config, token: { sealed: "", keyId: "", hint: "" } });
    ui.notifications.info(game.i18n.localize(`${LANG}.config.tokenCleared`));
    this.render();
  }

  /**
   * Save. The token field is write-only: blank leaves the stored secret
   * alone, and a value is sealed to the announced key or refused — storing a
   * token in the clear would publish it to every client in the world.
   */
  static async #onSubmit(_event, _form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const config = readClientConfig();
    const agent = readAgent();
    const typed = String(data.token ?? "").trim();

    let token = config.token;
    if (typed) {
      if (!agent.publicKey) {
        ui.notifications.error(game.i18n.localize(`${LANG}.config.gap.noKey`));
        return;
      }
      token = { sealed: await seal(agent.publicKey, typed), keyId: keyIdOf(agent.publicKey), hint: hintOf(typed) };
    }

    await writeClientConfig({
      discord: {
        guildId: data.guildId ?? "",
        chatChannelId: data.chatChannelId ?? "",
        judgeIds: data.judgeIds ?? "",
        relay: !!data.relay,
      },
      seat: { width: data.width, height: data.height, readySeconds: data.readySeconds },
      service: { logLevel: data.logLevel },
      token,
    });
    ui.notifications.info(game.i18n.localize(`${LANG}.config.saved`));
    this.render();
  }
}
