/* global game, foundry, ui */
/**
 * The Judge's roller window: a style, a category and a rarity, each offered
 * from the imported tables, and a Roll button that calls `rollAndPost`. The
 * window is a way to the entry point, not a place the roll lives: a sheet may
 * call `rollAndPost` without it.
 */
import { makeLoc } from "../lib/util.mjs";
import { LANG_PREFIX, ROLLER_TEMPLATE } from "./constants.mjs";
import { refusalNotice, rollAndPost } from "./chat-card.mjs";
import { readTables, starts } from "./roll-service.mjs";
import { appliesTo, rollable, rollArgs, rollerContext } from "./roller-options.mjs";

const loc = makeLoc(LANG_PREFIX);

/**
 * Switch off the picker the open style does not use. A node is found by
 * selector and told by `nodeType` or `matches`, never `instanceof`: a window
 * first rendered in a browser window of its own is built by that window's
 * document.
 */
function syncPickers(root) {
  const select = (name) => root.querySelector(`select[name="${name}"]`);
  const uses = appliesTo(select("style")?.value);
  const category = select("category");
  const rarity = select("rarity");
  if (category) category.disabled = !uses.category;
  if (rarity) rarity.disabled = !uses.rarity;
}

/** Bind the style picker, once per window root. */
function bind(root) {
  if (root?.nodeType !== 1 || root.dataset.acksMagicItemsBound) return;
  root.dataset.acksMagicItemsBound = "1";
  root.addEventListener("change", (event) => {
    if (event.target?.nodeType === 1 && event.target.matches('select[name="style"]')) syncPickers(root);
  });
  syncPickers(root);
}

/**
 * Open the roller. A seat that is not a Judge's is told so and nothing opens;
 * a world with nothing to roll is told what its import lacks and nothing opens
 * (no figure in the notice). Otherwise the Judge picks and Roll posts the card
 * through `rollAndPost`; Cancel posts nothing.
 *
 * @param {object} [options]
 * @param {object} [options.tables] the document's tables, in place of the registry's (tests, a walk)
 * @returns {Promise<{ok: boolean, reason?: string, result: object|null, message: ChatMessage|null}|false>}
 *   what `rollAndPost` answered, or false where nothing was rolled
 */
export async function openRoller({ tables } = {}) {
  if (!game.user?.isGM) {
    ui.notifications?.warn(refusalNotice({ reason: "gm-only" }));
    return false;
  }
  const offered = starts(tables === undefined ? readTables() : tables);
  if (!rollable(offered)) {
    ui.notifications?.warn(refusalNotice({ reason: "not-imported" }));
    return false;
  }
  const content = await foundry.applications.handlebars.renderTemplate(ROLLER_TEMPLATE, rollerContext(offered, { loc }));
  const picked = await foundry.applications.api.DialogV2.wait({
    classes: ["acks-extras", "acks-extras-scroll", "acks-extras-magicitems-roller"],
    window: { title: loc("roller.title"), icon: "fa-solid fa-dice-d20", resizable: true },
    content,
    render: (_event, dialog) => bind(dialog.element),
    buttons: [
      {
        action: "roll",
        label: loc("roller.roll"),
        icon: "fa-solid fa-dice-d20",
        default: true,
        callback: (_event, button) => {
          const field = (name) => button.form?.elements?.[name]?.value ?? "";
          return rollArgs({ style: field("style"), category: field("category"), rarity: field("rarity") });
        },
      },
      // `false`, never null: core resolves a nullish callback result to the button's action string.
      { action: "cancel", label: loc("roller.cancel"), icon: "fa-solid fa-xmark", callback: () => false },
    ],
    rejectClose: false,
  }).catch(() => false);
  if (!picked || typeof picked !== "object") return false;
  return rollAndPost({ ...picked, tables });
}
