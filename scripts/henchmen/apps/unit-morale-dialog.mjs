/* global game, foundry, Roll, ChatMessage */
/**
 * Unit morale roll for an acks-lib.group — a 2d6 check with the leader-modified
 * base (`commandMorale`, which already folds in the officer's RR 171 modifier and
 * any leader morale bonus) plus the situational modifiers the roller ticks when
 * it is time (RR 166). No auto-detection: the Judge selects what applies and
 * reads the result. The 2d6 roll goes to chat; interpretation stays with the
 * table (the three ACKS morale scales are close enough that auto-verdicts risk
 * using the wrong one).
 */
const MODS = [
  { key: "employerPresent", value: 2 },
  { key: "leaderLost", value: -2 },
  { key: "casualties", value: -1 },
  { key: "winning", value: 1 },
  { key: "orderedDanger", value: -2 },
];

export async function openUnitMoraleDialog(group) {
  if (!group?.system) return;
  const base = Number(group.system.commandMorale ?? 0);

  const rows = MODS.map(
    (m) =>
      `<label style="display:block"><input type="checkbox" name="${m.key}" /> ` +
      `${game.i18n.localize(`ACKS-HENCHMEN.unitMorale.mod.${m.key}`)} (${m.value >= 0 ? "+" : ""}${m.value})</label>`
  ).join("");
  const content = `<div class="unit-morale-dialog">
      <p>${game.i18n.format("ACKS-HENCHMEN.unitMorale.base", { name: foundry.utils.escapeHTML(group.name), base: base >= 0 ? "+" + base : base })}</p>
      ${rows}
      <label style="display:block">${game.i18n.localize("ACKS-HENCHMEN.unitMorale.other")}
        <input type="number" name="other" value="0" style="width:5em" /></label>
    </div>`;

  const total = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize("ACKS-HENCHMEN.unitMorale.title") },
    content,
    ok: {
      label: game.i18n.localize("ACKS-HENCHMEN.unitMorale.roll"),
      callback: (_event, button) => {
        const f = button.form.elements;
        let t = base;
        for (const m of MODS) if (f[m.key]?.checked) t += m.value;
        t += Number(f.other?.value) || 0;
        return t;
      },
    },
  }).catch(() => null);
  if (total == null) return;

  const roll = await new Roll("2d6").evaluate();
  const result = roll.total + total;
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: group }),
    flavor: game.i18n.format("ACKS-HENCHMEN.unitMorale.result", {
      name: group.name,
      die: roll.total,
      mod: total >= 0 ? "+" + total : total,
      result,
    }),
  });
}
