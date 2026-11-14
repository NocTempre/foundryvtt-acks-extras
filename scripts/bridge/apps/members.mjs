/* global game, ui, foundry, CONST, User, fromUuidSync */
/**
 * The Judge's window for who in Discord is who in the world: every binding the
 * store holds, a row to make one, and a button to create the Foundry user first.
 *
 * It offers the members the bot has heard from; one the bot has not met is
 * linked by pasted id. It writes the same binding store `/link` writes, through
 * the same arithmetic. A user it creates is a Player with a password nobody
 * knows; the member sets their own from Discord (`/account password`).
 */
import { MODULE_ID, LANG } from "../constants.mjs";
import { readStore, writeStore } from "../bindings.mjs";
import { bindUser, unbindUser, activeOf } from "../bindings-logic.mjs";
import { readAgent } from "../client-config.mjs";
import { memberLabel } from "../client-config-logic.mjs";
import { userNameProblem, randomSecret } from "../accounts-logic.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

const KIND = "discord";
const ID = /^[0-9]{5,25}$/;

/** The Discord member to Foundry user linking window (Judge only). */
export class BridgeMembersApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "acks-extras-bridge-members",
    tag: "form",
    classes: ["acks-ui", "acks-extras", "acks-extras-bridge-members", "acks-extras-scroll"],
    position: { width: 620, height: "auto" },
    window: { resizable: true, icon: "fas fa-user-group" },
    form: { handler: BridgeMembersApp.#onLink, closeOnSubmit: false },
    actions: {
      refresh: BridgeMembersApp.#onRefresh,
      unlink: BridgeMembersApp.#onUnlink,
      create: BridgeMembersApp.#onCreate,
    },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/bridge/members.hbs` },
  };

  get title() {
    return game.i18n.localize(`${LANG}.members.title`);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const store = readStore();
    const agent = readAgent();
    const seen = new Map(agent.members.map((m) => [m.id, m]));
    const roleName = (u) => game.i18n.localize(`${LANG}.members.role.${u.role ?? 0}`);

    context.bindings = Object.entries(store.users)
      .filter(([key]) => key.startsWith(`${KIND}:`))
      .map(([key, uid]) => {
        const externalId = key.slice(KIND.length + 1);
        const user = game.users.get(uid) ?? null;
        const uuid = activeOf(store, uid);
        const actor = uuid ? fromUuidSync(uuid) : null;
        return {
          externalId,
          member: memberLabel(seen.get(externalId) ?? { id: externalId }),
          known: seen.has(externalId),
          user: user ? { name: user.name, role: roleName(user), isGM: user.isGM, active: user.active } : null,
          userId: uid,
          actor: actor?.name ?? "",
        };
      })
      .sort((a, b) => a.member.localeCompare(b.member));

    const bound = new Set(context.bindings.map((b) => b.externalId));
    context.members = agent.members.filter((m) => !bound.has(m.id)).map((m) => ({ id: m.id, label: memberLabel(m) }));
    context.hasMembers = context.members.length > 0;
    context.users = game.users.contents
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((u) => ({ id: u.id, name: u.name, isGM: u.isGM, role: roleName(u) }));
    context.botSeen = agent.status.state !== "unseen";
    return context;
  }

  static #onRefresh() {
    this.render();
  }

  /** The member the form names: the pasted id wins over the dropdown, and either must be a Discord id. */
  static #memberOf(data) {
    const typed = String(data.memberId ?? "").trim();
    const picked = String(data.member ?? "").trim();
    const id = typed || picked;
    if (!ID.test(id)) throw new Error(game.i18n.localize(`${LANG}.members.badId`));
    return id;
  }

  /** Save = link the chosen member to the chosen user. */
  static async #onLink(_event, _form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    let externalId;
    try {
      externalId = BridgeMembersApp.#memberOf(data);
    } catch (err) {
      ui.notifications.warn(err.message);
      return;
    }
    const user = game.users.get(String(data.userId ?? ""));
    if (!user) {
      ui.notifications.warn(game.i18n.localize(`${LANG}.members.noUser`));
      return;
    }
    await writeStore(bindUser(readStore(), KIND, externalId, user.id));
    ui.notifications.info(game.i18n.format(`${LANG}.members.linked`, { user: user.name }));
    this.render();
  }

  /** Create a Player user named after the member (or as typed), then link. */
  static async #onCreate() {
    const data = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(this.element).object);
    let externalId;
    try {
      externalId = BridgeMembersApp.#memberOf(data);
    } catch (err) {
      ui.notifications.warn(err.message);
      return;
    }
    const seen = readAgent().members.find((m) => m.id === externalId);
    const name = String(data.newName ?? "").trim() || memberLabel(seen ?? {});
    const problem = userNameProblem(name);
    if (problem) {
      ui.notifications.warn(game.i18n.localize(`${LANG}.members.${problem === "empty" ? "noName" : "longName"}`));
      return;
    }
    if (game.users.find((u) => u.name.toLowerCase() === name.toLowerCase())) {
      ui.notifications.warn(game.i18n.format(`${LANG}.members.nameTaken`, { name }));
      return;
    }
    const user = await User.create({ name, role: CONST.USER_ROLES.PLAYER, password: randomSecret() });
    if (!user) {
      ui.notifications.error(game.i18n.localize(`${LANG}.members.createFailed`));
      return;
    }
    await writeStore(bindUser(readStore(), KIND, externalId, user.id));
    ui.notifications.info(game.i18n.format(`${LANG}.members.created`, { user: user.name }));
    this.render();
  }

  static async #onUnlink(_event, target) {
    const externalId = String(target?.dataset?.externalId ?? "");
    if (!externalId) return;
    await writeStore(unbindUser(readStore(), KIND, externalId));
    ui.notifications.info(game.i18n.localize(`${LANG}.members.unlinked`));
    this.render();
  }
}
