/* global game, foundry, CONFIG */
/**
 * The cast dialog: what the seat decides before a spell spends anything. The
 * form of a reversible spell, the pick of each choice group, the caster level
 * where nothing resolved one (typed, and marked as set by hand in its
 * tooltip), the weapon a buff is cast on where the one targeted creature has
 * weapons, a situational modifier for the targets' saves, the card's
 * visibility, the targets the seat has, and each verdict that stands in the
 * way. A verdict that blocks a Player disables the Cast button for the form
 * it belongs to; a Judge reads it as a warning. Where a thrown row's count is
 * above one and several targets are had, a split of its throws among them is
 * offered, defaulting to round-robin; a split over the count shows its verdict
 * as the seat types, and blocks a Player the same way. The range verdict's tooltip
 * names the targets out of range, each distance and the range's parts, and a
 * note says where the range could not be measured. Cancel and a closed window
 * both answer null, so nothing is spent.
 *
 * The window carries `acks-extras-scroll`, so it scrolls and takes the drag
 * corner (`lib/window-resize.mjs`).
 */
import { MODULE_ID } from "../constants.mjs";
import { describeSpellEffect } from "../describe.mjs";
import { instancesTip } from "../cast-instances.mjs";

const TEMPLATE = `modules/${MODULE_ID}/templates/magic/cast-dialog.hbs`;

/** The visibility modes the dialog offers, as lib's roll dialog offers them. */
const VISIBILITY_MODES = ["public", "gm", "blind", "self"];

const loc = (key, data = {}) => game.i18n.format(`ACKS-MAGIC.cast.${key}`, data);

/** The text of a range verdict's tooltip: the targets out of range with each measured distance, then the range's parts (figure and source) and the spell's page reference. */
function rangeTip(v, cite) {
  const targets = v.out.map((t) => loc("tip.rangeTarget", { name: t.name, gap: Math.round(t.gap * 10) / 10 })).join("; ");
  const parts = (v.parts ?? []).map((p) => loc(`tip.rangePart.${p.key}`, { value: Math.round(p.value * 100) / 100 })).join(" · ");
  return loc("tip.range", { targets, limit: Math.round(v.limit * 10) / 10, parts, cite });
}

/** The template's data from the cast's context. */
export function dialogContext(ctx, { mode = ctx.modes?.[0], visibility = "public", modeLabel = (k) => k, visibilityLabel = (k) => k } = {}) {
  const groups = [];
  for (const m of ctx.modes ?? []) {
    for (const group of ctx.groups?.[m] ?? []) {
      groups.push({
        mode: m,
        id: group.id,
        label: loc("dialog.pick"),
        legend: loc("dialog.pickLegend"),
        // An option is one or more rows, read as the card will read them.
        options: (group.options ?? group.rows.map((entry) => ({ token: entry.key, rows: [entry] }))).map(({ token, rows }) => ({ key: token, label: rows.map(({ row }) => describeSpellEffect(row).text).join(" · ") })),
      });
    }
  }
  const level = ctx.level ?? {};
  const cap = ctx.capacity;
  // A thrown row's split of its throws among the targets, one figure per target by position.
  const splits = (ctx.modes ?? []).flatMap((m) =>
    (ctx.instances?.[m] ?? []).map((item) => ({
      mode: m,
      key: item.key,
      pick: item.pick,
      option: item.option,
      count: item.count.value,
      label: loc("dialog.allocate", { count: item.count.value }),
      rowLabel: describeSpellEffect(item.row).text,
      tip: instancesTip(item.count, ctx.cite ?? "", loc),
      inputs: (ctx.targets ?? []).map((t, index) => ({ index, name: t.name, value: item.split?.[String(index)] ?? 0 })),
      severity: ctx.isGM ? "warn" : "block",
      over: loc(`notice.${ctx.isGM ? "verdict" : "blocked"}.tooManyInstances`, { name: ctx.caster?.name ?? "", max: item.count.value, over: "" }),
    })),
  );
  return {
    splits,
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
    rangeNote: ctx.rangeUnmeasured ? loc("dialog.rangeUnmeasured") : "",
    verdicts: (ctx.modes ?? []).map((m) => ({
      mode: m,
      items: (ctx.verdicts?.[m] ?? []).map((v) => ({
        severity: v.severity,
        text: loc(`notice.${v.severity === "block" ? "blocked" : "verdict"}.${v.key}`, { name: ctx.caster?.name ?? "", names: (v.out ?? []).map((t) => t.name).join(", "), max: v.max ?? "", over: v.over ?? "" }),
        tip: v.key === "outOfRange" ? rangeTip(v, ctx.cite ?? "") : v.key === "tooManyTargets" && ctx.cite ? loc("tip.cite", { cite: ctx.cite }) : "",
      })),
    })),
  };
}

/**
 * Show the selected mode's form alone, and gate the Cast button on that mode's
 * blocking verdicts. A throw split belongs to its form and, where it belongs to
 * a choice, to the option chosen; its total is read as the seat types, and a
 * total over the row's count shows its verdict and stops a Player.
 */
function bind(root, { isGM }) {
  const select = root.querySelector?.("[data-cast-mode]");
  const picks = [...(root.querySelectorAll?.("select[data-pick]") ?? [])];
  const sync = () => {
    const mode = select?.value ?? root.querySelector?.("[data-cast-for]")?.dataset.castFor;
    let stopped = false;
    for (const el of root.querySelectorAll?.("[data-cast-for]") ?? []) {
      const here = !mode || el.dataset.castFor === mode;
      el.hidden = !here;
      if (here && !isGM && el.querySelector?.('[data-severity="block"]')) stopped = true;
    }
    for (const group of root.querySelectorAll?.("[data-alloc-row]") ?? []) {
      const chosen = group.dataset.allocPick ? picks.find((p) => p.dataset.pick === group.dataset.allocPick) : null;
      const here = (!mode || group.dataset.castFor === mode) && (!chosen || chosen.value === group.dataset.allocOption);
      group.hidden = !here;
      const total = [...group.querySelectorAll("input[data-alloc-index]")].reduce((sum, input) => sum + (Number.isInteger(Number(input.value)) && Number(input.value) > 0 ? Number(input.value) : 0), 0);
      const over = total > Number(group.dataset.allocCount);
      const note = group.querySelector("[data-alloc-over]");
      if (note) note.hidden = !over;
      if (here && over && !isGM) stopped = true;
    }
    const cast = root.querySelector?.('button[data-action="cast"]');
    if (cast) cast.disabled = stopped;
  };
  select?.addEventListener("change", sync);
  for (const pick of picks) pick.addEventListener("change", sync);
  for (const input of root.querySelectorAll?.("input[data-alloc-index]") ?? []) input.addEventListener("input", sync);
  sync();
}

/** The cast dialog. */
export class CastDialog {
  /**
   * Ask for a cast's choices.
   * @param {object} ctx  the cast's context: `spell`, `modes`, `groups`, `level`, `levelNeeded`, `weapons`, `needsWeapon`, `targets`, `instances`, `saves`, `verdicts`, `capacity`, `isGM`
   * @returns {Promise<{mode: string, picks: Record<string, string>, allocation: Record<string, Record<string, string>>, item: string, casterLevel: string, situational: string, visibility: string}|null>}
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
            // The split of each shown row's throws, by target position; a form or option not chosen is hidden and answers none.
            const allocation = {};
            for (const input of form.querySelectorAll("[data-alloc-row]:not([hidden]) input[data-alloc-index]")) {
              const row = input.closest("[data-alloc-row]").dataset.allocRow;
              (allocation[row] ??= {})[input.dataset.allocIndex] = input.value;
            }
            return {
              allocation,
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
