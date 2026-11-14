/* global game, foundry, Actor, Hooks */
/**
 * One concrete actor from a template: the Foundry half of the generator, shared
 * by the template's own sheet and a family dropped on a group sheet.
 * template-logic.mjs holds the pure choosing and merging.
 */
import { MODULE_ID, LANG_PREFIX, TEMPLATE_HOOKS } from "./constants.mjs";
import { chooseAxes, mergePatch, resolveActor, rollDice, rollMenu } from "./template-logic.mjs";
import { hitDiceOrLevel } from "./actor-read.mjs";
import { actorFolder } from "./util.mjs";

/**
 * Where a generated creature goes: a top-level folder of its own, never the
 * template's, since a template in a compendium has a folder id the sidebar
 * cannot resolve.
 */
const generatedFolder = () => actorFolder(game.i18n?.localize?.(`${LANG_PREFIX}.template.folder`) ?? "Generated");

/**
 * Build one concrete actor from a template, in the generated folder.
 *
 * @param {Actor} template
 * @param {object} [opts]
 * @param {object} [opts.pins] the Judge's choice per axis key; an axis left out is rolled
 * @param {Actor|null} [opts.base] an actor that seeds generation, the template's patches on top
 * @returns {Promise<Actor|null>} null when core refused the create
 */
export async function generateFromTemplate(template, { pins = {}, base = null } = {}) {
  const sys = template.system;

  // Values an axis may derive from a dropped base.
  const baseValues = {};
  if (base) {
    const hd = hitDiceOrLevel(base);
    if (hd != null) baseValues.hd = hd;
  }

  const { choices, log } = chooseAxes(sys, { pinned: pins, baseValues });
  const resolved = resolveActor(sys, choices, { baseName: base?.name ?? "", templateName: template.name });

  // A dropped base actor seeds generation (full system/items/flags), the
  // template's patches layered on top — what makes templates compose.
  if (base) {
    const seeded = base.system.toObject();
    mergePatch(seeded, resolved.system);
    resolved.system = seeded;
    resolved.items = [...base.items.map((i) => i.toObject()), ...resolved.items];
    const baseFlags = foundry.utils.deepClone(base.flags ?? {});
    delete baseFlags.core;
    if (baseFlags[MODULE_ID]) delete baseFlags[MODULE_ID].generated;
    const stackedFlags = baseFlags;
    mergePatch(stackedFlags, resolved.flags ?? {});
    resolved.flags = stackedFlags;
    if (!resolved.art && base.img) resolved.art = base.img;
  }

  // The rolled ability menu: budget printed on the budget axis's chosen row.
  let menuPicks = [];
  if ((sys.menu?.rows ?? []).length) {
    const axis = (sys.axes ?? []).find((a) => a.key === sys.menu.budgetAxis);
    const option = axis?.options?.find((o) => o.key === choices[axis.key]);
    const budget = option?.menuBudget ?? 0;
    menuPicks = rollMenu(sys.menu, budget).picks;
  }

  // Description: the option snippets, then the rolled abilities. A resolved
  // sub-roll rides its ability as a rolled note.
  const htmlParts = [...resolved.htmlParts];
  for (const pick of menuPicks) {
    let part = pick.html || `<p>${pick.label}</p>`;
    if (pick.subResult) {
      const s = pick.subResult;
      part += `<p><em>${s.die}${s.twice ? " ×2" : ""} → ${s.rolls.join(", ")}: ${s.texts.join("; ")}</em></p>`;
    }
    htmlParts.push(part);
  }
  const biography = htmlParts.join("");

  const type = sys.output?.actorType || "monster";
  const system = resolved.system;
  if (biography) {
    system.details = { ...(system.details ?? {}), biography: `${system.details?.biography ?? ""}${biography}` };
  }

  // Actor-level channels from preset options: sheet-extras flags and
  // prototype-token fragments ride the resolved payload; the provenance flag
  // is ours and always wins its own key.
  const prototypeToken = {
    ...(resolved.art || resolved.tint
      ? { texture: { ...(resolved.art ? { src: resolved.art } : {}), ...(resolved.tint ? { tint: resolved.tint } : {}) } }
      : {}),
    ...(resolved.token ?? {}),
  };
  // A caster level given as a die is rolled here, before the repertoire
  // listener reads the level, and logged beside the axis choices.
  const casting = resolved.flags?.[MODULE_ID]?.extras?.spellcasting;
  if (casting?.levelDie && !Number.isInteger(casting.level)) {
    const level = rollDice(casting.levelDie);
    if (level != null) {
      casting.level = level;
      log.push({ axis: "casterLevel", option: String(level), source: "rolled", roll: level, die: casting.levelDie });
    }
  }

  // A cell that gives a rating and no hit points has them rolled from the
  // rating, logged like the caster's level.
  if (resolved.rollHp && system.hp?.hd) {
    const hp = rollDice(system.hp.hd);
    if (hp != null) {
      system.hp = { ...system.hp, value: hp, max: hp };
      log.push({ axis: "hitPoints", option: String(hp), source: "rolled", roll: hp, die: system.hp.hd });
    }
  }

  // What a generated creature carries beyond its patches is a listener's
  // to add before the write — a repertoire drawn onto its slot block.
  Hooks.callAll(TEMPLATE_HOOKS.RESOLVED, { resolved, template, type, choices });
  const created = await Actor.create({
    name: resolved.name || template.name,
    type,
    folder: (await generatedFolder())?.id ?? null,
    ...(resolved.art ? { img: resolved.art } : {}),
    ...(Object.keys(prototypeToken).length ? { prototypeToken } : {}),
    system,
    items: resolved.items,
    flags: {
      ...(resolved.flags ?? {}),
      [MODULE_ID]: {
        ...(resolved.flags?.[MODULE_ID] ?? {}),
        generated: {
          templateUuid: template.uuid,
          choices,
          log,
          menu: menuPicks.map((p) => p.label),
        },
      },
    },
  });
  return created ?? null;
}
