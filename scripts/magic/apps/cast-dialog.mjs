/* global game, foundry, CONFIG */
/**
 * The cast dialog: what the seat decides before a spell spends anything. The
 * form of a reversible spell, the pick of each choice group, the caster level
 * where nothing resolved one (typed, and marked as set by hand in its
 * tooltip), the weapon a buff is cast on where the one targeted creature has
 * weapons, a situational modifier for the targets' saves, the card's
 * visibility, the targets the seat has, and each verdict that stands in the
 * way. A verdict that blocks a Player disables the Cast button for the form
 * it belongs to; a Judge reads it as a warning. Cancel and a closed window
 * both answer null, so nothing is spent.
 *
 * The window carries `acks-extras-scroll`, so it scrolls and takes the drag
 * corner (`lib/window-resize.mjs`).
 */
import { MODULE_ID } from "../constants.mjs";
import { describeSpellEffect } from "../describe.mjs";

const TEMPLATE = `modules/${MODULE_ID}/templates/magic/cast-dialog.hbs`;

/** The visibility modes the dialog offers, as lib's roll dialog offers them. */
const VISIBILITY_MODES = ["public", "gm", "blind", "self"];

const loc = (key, data = {}) => game.i18n.format(`ACKS-MAGIC.cast.${key}`, data);

/** The template's data from the cast's context. */
export function dialogContext(ctx, { mode = ctx.modes?.[0], visibility = "public", modeLabel = (k) => k, visibilityLabel = (k) => k } = {}) {
  const groups = [];
  for (const m of ctx.modes ?? []) {
    for (const group of ctx.groups?.[m] ?? []) {
      groups.push({
        mode: m,
        id: group.id,
        label: group.id,
        options: group.rows.map(({ row, key }) => ({ key, label: describeSpellEffect(row) })),
      });
    }
  }
  const level = ctx.level ?? {};
  const cap = ctx.capacity;
  return {
    hasModes: (ctx.modes?.length ?? 0) > 1,
    modes: (ctx.modes ?? []).map((key) => ({ key, label: modeLabel(key), selected: key === mode })),
    groups,
    level: {
      show: Boolean(ctx.levelNeeded && !level.value),
      value: level.value ?? null,
      line: level.value ? loc("dialog.levelLine", { value: level.value }) : "",
      tip: level.source ? loc(`tip.level.${level.source}`, { value: level.value }) : loc("tip.level.hand", { value: "" }),
    },
    weapon: {
      modes: Object.entries(ctx.needsWeapon ?? {}).filter(([, needed]) => needed).map(([m]) => m),
      options: (ctx.weapons ?? []).map((w) => ({ id: w.id, label: w.magic ? loc("dialog.weaponMagic", { name: w.name }) : w.name })),
    },
    // At any moment of a begun fight but the caster's turn the button declares the spell.
    declaring: ctx.moment === "declare" ? loc("dialog.declaring", { name: ctx.caster?.name ?? "" }) : "",
    saves: Boolean(ctx.saves),
    situationalTip: loc("tip.situational"),
    visibility: VISIBILITY_MODES.map((key) => ({ key, label: visibilityLabel(key), selected: key === visibility })),
    capacity:
      cap && cap.verdict !== "unknown" && cap.max != null
        ? { line: loc("dialog.capacity", { used: cap.used, max: cap.max, level: cap.spellLevel ?? "" }), tip: loc("tip.capacity", { source: loc(`tip.capacitySource.${cap.source}`) }) }
        : {},
    targets: ctx.targets ?? [],
    verdicts: (ctx.modes ?? []).map((m) => ({
      mode: m,
      items: (ctx.verdicts?.[m] ?? []).map((v) => ({ severity: v.severity, text: loc(`notice.${v.severity === "block" ? "blocked" : "verdict"}.${v.key}`, { name: ctx.caster?.name ?? "" }) })),
    })),
  };
}

/** Show the selected mode's form alone, and gate the Cast button on that mode's blocking verdicts. */
function bind(root, { isGM }) {
  const select = root.querySelector?.("[data-cast-mode]");
  const sync = () => {
    const mode = select?.value ?? root.querySelector?.("[data-cast-for]")?.dataset.castFor;
    let stopped = false;
    for (const el of root.querySelectorAll?.("[data-cast-for]") ?? []) {
      const here = !mode || el.dataset.castFor === mode;
      el.hidden = !here;
      if (here && !isGM && el.querySelector?.('[data-severity="block"]')) stopped = true;
    }
    const cast = root.querySelector?.('button[data-action="cast"]');
    if (cast) cast.disabled = stopped;
  };
  select?.addEventListener("change", sync);
  sync();
}

/** The cast dialog. */
export class CastDialog {
  /**
   * Ask for a cast's choices.
   * @param {object} ctx  the cast's context: `spell`, `modes`, `groups`, `level`, `levelNeeded`, `weapons`, `needsWeapon`, `targets`, `saves`, `verdicts`, `capacity`, `isGM`
   * @returns {Promise<{mode: string, picks: Record<string, string>, item: string, casterLevel: string, situational: string, visibility: string}|null>}
   */
  static async wait(ctx) {
    const modeLabel = (key) => loc(`dialog.mode.${key}`);
    const visibilityLabel = (key) => game.i18n.localize(CONFIG.ChatMessage.modes?.[key]?.label ?? key);
    const visibility = game.settings.get("core", "messageMode");
    const content = await foundry.applications.handlebars.renderTemplate(TEMPLATE, dialogContext(ctx, { visibility, modeLabel, visibilityLabel }));
    const answer = await foundry.applications.api.DialogV2.wait({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: ctx.spell?.name ?? loc("dialog.title"), resizable: true },
      content,
      render: (_event, dialog) => {
        const root = dialog.element;
        if (root?.nodeType === 1) bind(root, { isGM: ctx.isGM });
      },
      buttons: [
        {
          action: "cast",
          label: ctx.moment === "declare" ? loc("dialog.declare") : loc("dialog.cast"),
          icon: "fa-solid fa-wand-sparkles",
          default: true,
          callback: (_event, button) => {
            const form = button.form;
            const picks = {};
            for (const el of form.querySelectorAll("select[data-pick]")) picks[el.dataset.pick] = el.value;
            return {
              mode: form.elements.mode?.value ?? ctx.modes[0],
              picks,
              item: form.querySelector("[data-cast-for]:not([hidden]) select[data-weapon]")?.value ?? "",
              casterLevel: form.elements.casterLevel?.value ?? "",
              situational: form.elements.situational?.value ?? "",
              visibility: form.elements.visibility?.value ?? "public",
            };
          },
        },
        // A callback that returns nothing resolves to the action string, which is truthy: a cancel answers false.
        { action: "cancel", label: loc("dialog.cancel"), icon: "fa-solid fa-xmark", callback: () => false },
      ],
      rejectClose: false,
    });
    return answer && typeof answer === "object" ? answer : null;
  }
}
