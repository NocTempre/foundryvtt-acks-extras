/* global game, foundry, ui */
/**
 * Binding a character to a class, in the window the Scores Generator already
 * was.
 *
 * The picker used to be a two-field dialog — class, level — followed by a
 * second dialog that listed the changes and asked every open pick. Beside it
 * the generator (stat-page.mjs) asked the SAME questions better: it offered the
 * class's starting packages, it counted the Intellect bonus, and it said what a
 * package would hand over before handing it over. A character bound from their
 * sheet reached none of that, so binding at 1st level gave the class's numbers
 * and no starting package at all.
 *
 * So this is the generator's own layout, minus the column it has no use for.
 * The attribute rolls are replaced by the level being SET and the picks that
 * come with it — a played character's ladder, which is what the level-up wizard
 * would have asked one rung at a time. The class and package column and the
 * choices column are the generator's, built from the same code (panels.mjs) and
 * asked with the same rung control (picks.mjs).
 *
 * WHAT IT NEVER DOES IS WIPE. Generating a character REPLACES the last run of
 * the page, because that is what generating means; binding a class to a
 * character who already owns things is the opposite act. A package is therefore
 * opt-in here and defaults to none, and what it will ADD is stated on the
 * panel — see docs/classes/DECISIONS.md.
 */
import { MODULE_ID, LANG_PREFIX, FLAG_CLASSES } from "./constants.mjs";
import { classItems, classForActor, byBookOrder } from "./registry.mjs";
import { applyClass } from "./apply.mjs";
import { applyTemplate, netBonusPicks, templateShortfall } from "./chargen.mjs";
import { awardsThrough, choosableGenerals, grantAbility, refOf } from "./grants.mjs";
import { classPanelHtml, picksPanelHtml, templatePanelHtml } from "./panels.mjs";
import { answeredByTemplate, grantableRefs, isGranted, rungLabel, rungOptions } from "./picks.mjs";
import { templateGrantKeys } from "./template-packages.mjs";
import { unmetRequirements } from "./stat-page.mjs";
import { makeLoc } from "../lib/util.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const loc = makeLoc(LANG_PREFIX);

/** The pickers OFFER core classes (plus whatever the actor is already bound
 *  to); everything else waits behind the show-all toggle. Listed as the books
 *  print them, which is the order a reader looks a class up in. */
export function offeredClasses(actor, showAll = false) {
  const bound = classForActor(actor);
  return classItems()
    .filter((i) => showAll || i.system.core || i.uuid === bound?.uuid)
    .sort(byBookOrder);
}

/**
 * The class picker: one window, three columns, no second dialog.
 *
 * Every question is asked here and answered here, and `applyClass` is called
 * with the answers rather than being asked to collect them again — which is
 * what stopped the same rung being put to a player twice on one binding.
 */
export class ClassAssignApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @param {object} options @param {Actor} options.actor the character bound */
  constructor({ actor, ...options } = {}) {
    super({ id: `acks-classes-assign-${actor.id}`, ...options });
    this.actor = actor;
    const bound = classForActor(actor);
    /**
     * Everything the window has been told, rebuilt into markup on every change.
     *
     * NEVER call this `state`: ApplicationV2 defines `state` as a getter for
     * its own render lifecycle, so assigning one throws in the constructor and
     * the window never opens at all.
     */
    this.binding = {
      classUuid: bound?.uuid ?? offeredClasses(actor)[0]?.uuid ?? "",
      showAll: false,
      level: Math.max(1, Number(actor.system?.details?.level) || 1),
      templateMin: null,
      /** Rung answers keyed by award key, so a rung keeps its answer when the
       *  level changes and the list of rungs on screen changes with it. */
      answers: {},
      bonusPicks: [],
    };
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["acks-ui", "acks", "acks-extras", "acks-extras-scroll", "acks-extras-classes-assign"],
    position: { width: 1000, height: "auto" },
    window: { icon: "fa-solid fa-graduation-cap", contentClasses: ["standard-form"], resizable: true },
    form: { handler: ClassAssignApp.#onSubmit, submitOnChange: true, closeOnSubmit: false },
  };

  // Two parts because a part renders into ONE root element, and the three
  // columns already are one — the Apply button cannot live beside them.
  static PARTS = {
    columns: { template: `modules/${MODULE_ID}/templates/classes/assign.hbs`, scrollable: [""] },
    footer: { template: `modules/${MODULE_ID}/templates/classes/assign-footer.hbs` },
  };

  /** @override */
  get title() {
    return loc("pick.title", { name: this.actor.name });
  }

  /** The class document currently selected, or null while the world has none. */
  get #classItem() {
    const offered = offeredClasses(this.actor, this.binding.showAll);
    if (!offered.some((c) => c.uuid === this.binding.classUuid)) this.binding.classUuid = offered[0]?.uuid ?? "";
    return offered.find((c) => c.uuid === this.binding.classUuid) ?? null;
  }

  /**
   * Every rung this binding leaves open, split the way the columns are.
   *
   * A rung already recorded as answered — by the level-up wizard, by chargen,
   * or by a previous binding — is not asked again; that record is what stops a
   * played character meeting every choice they ever made a second time.
   */
  #rungs(cls, level, template = null) {
    if (!cls) return { opening: [], ladder: [] };
    const taken = this.actor.getFlag(MODULE_ID, FLAG_CLASSES)?.awardsTaken ?? [];
    const { choices } = awardsThrough(this.actor, cls, level, taken);
    const granted = template ? templateGrantKeys(template) : null;
    const row = (a) => ({
      name: `rung-${a.key}`,
      label: rungLabel(a),
      atLevel: a.atLevel ?? 1,
      // Only the opening picks can be answered by a package; a rung the
      // character climbed to at 4th is theirs whatever they start with.
      options: rungOptions(a.choice, cls, this.actor, (a.atLevel ?? 1) <= 1 ? granted : null),
      selected: this.binding.answers[a.key] ?? "",
    });
    const opening = choices.filter((a) => (a.atLevel ?? 1) <= 1);
    return {
      // The opening picks belong with the package that may answer them; the
      // rest are the ladder a played character climbed. A chosen package makes
      // the level-1 proficiency picks itself (picks.mjs), so they come off the
      // page rather than being asked beside the package that answered them.
      opening: (template ? opening.filter((a) => !answeredByTemplate(a)) : opening).map(row),
      ladder: choices.filter((a) => (a.atLevel ?? 1) > 1).map(row),
    };
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const cls = this.#classItem;
    const level = Math.max(1, Math.min(this.binding.level, cls?.system?.maximumLevel || 14));
    this.binding.level = level;

    const templates = cls?.system?.templates ?? [];
    // Every package the class prints is on offer: the 3d6 band rule governs a
    // character being GENERATED, and nobody is rolling a template die here.
    const legal = [...templates].sort((a, b) => a.rollMin - b.rollMin);
    if (this.binding.templateMin != null && !legal.some((t) => t.rollMin === this.binding.templateMin)) {
      this.binding.templateMin = null;
    }
    const template = legal.find((t) => t.rollMin === this.binding.templateMin) ?? null;

    const intScore = Number(actor.system?.scores?.int?.value) || 0;
    const assumed = cls?.system?.templatesAssumeIntBonus ?? 0;
    const bonusCount = template ? netBonusPicks(intScore, assumed) : 0;
    const { opening, ladder } = this.#rungs(cls, level, template);
    const granted = template ? templateGrantKeys(template) : null;

    context.levelColumn = this.#levelColumnHtml(cls, level, ladder);
    context.classColumn = classPanelHtml({
      offered: offeredClasses(actor, this.binding.showAll),
      selectedUuid: this.binding.classUuid,
      unmet: cls ? unmetRequirements(cls, this.#scores()) : [],
      controls: `<div class="form-group">
          <label class="checkbox"><input type="checkbox" name="acks-showall"${
            this.binding.showAll ? " checked" : ""
          } /> ${esc(loc("pick.showAll"))}</label>
        </div>`,
    });
    context.templateColumn = templatePanelHtml({
      legal,
      selectedMin: this.binding.templateMin,
      template,
      noneLabel: loc("assign.noPackage"),
      // A package on this window ADDS; it never replaces. Said where the choice
      // is made, because the character it is being added to already owns things.
      ruleHint: template ? loc("assign.packageAdds") : loc("assign.packageHint"),
      shortfall: template ? templateShortfall(intScore, assumed) : null,
    });
    context.picksColumn = picksPanelHtml({
      rungs: opening,
      bonus: Array.from({ length: bonusCount }, (_, i) => ({
        name: `bonus-${i}`,
        label: loc("chargen.bonusPick", { n: i + 1 }),
        // Chosen "on top of those listed for the template" (RR Ch. 2), so the
        // picks stand — minus the abilities the package is already handing over.
        options: choosableGenerals()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((item) => ({ ref: refOf(item), name: item.name }))
          .filter((o) => !isGranted(granted, o)),
        selected: this.binding.bonusPicks[i] ?? "",
      })),
      offerAnswered: true,
    });
    return context;
  }

  /** The character's own scores, which is what a class's minimums are read
   *  against here — they are set, not being rolled. */
  #scores() {
    const out = {};
    for (const [key, score] of Object.entries(this.actor.system?.scores ?? {})) {
      out[key] = Number(score?.value) || 0;
    }
    return out;
  }

  /**
   * Column one: the level being set, and the picks the ladder owes above 1st.
   *
   * This is the column the generator spends on attribute dice. A character
   * bound from their sheet is not being rolled, so what stands here is the one
   * number this window actually decides and everything that follows from it.
   */
  #levelColumnHtml(cls, level, ladder) {
    const max = cls?.system?.maximumLevel || 14;
    return `<div class="form-group">
        <label>${esc(loc("pick.level"))}</label>
        <div class="form-fields">
          <input type="number" name="acks-level" value="${level}" min="1" max="${max}" step="1" />
        </div>
        <p class="hint">${esc(loc("assign.levelHint"))}</p>
      </div>
      ${
        ladder.length
          ? `<p><strong>${esc(loc("assign.ladder"))}</strong></p>${picksPanelHtml({
              rungs: ladder,
              offerAnswered: true,
            })}`
          : `<p class="hint">${esc(loc("assign.ladderNone"))}</p>`
      }`;
  }

  /**
   * One handler for both jobs the form does.
   *
   * `submitOnChange` means every control fires this, so the event's own type is
   * what separates "the player changed something, redraw" from "the player
   * pressed Apply, write it". Nothing is written on a change.
   */
  static async #onSubmit(event, form, formData) {
    const data = formData.object ?? {};
    this.binding.showAll = !!data["acks-showall"];
    if (data["acks-class"]) this.binding.classUuid = String(data["acks-class"]);
    if (data["acks-level"] != null && data["acks-level"] !== "") this.binding.level = Number(data["acks-level"]) || 1;
    this.binding.templateMin = data["acks-template"] === "" || data["acks-template"] == null ? null : Number(data["acks-template"]);
    for (const [name, value] of Object.entries(data)) {
      if (name.startsWith("rung-")) this.binding.answers[name.slice(5)] = String(value ?? "");
      else if (name.startsWith("bonus-")) this.binding.bonusPicks[Number(name.slice(6))] = String(value ?? "");
    }
    if (event.type !== "submit") return this.render();
    await this.#apply();
    await this.close();
  }

  /** Write what the window was told: the class at its level with the ladder's
   *  awards, then the package if one was chosen. */
  async #apply() {
    const cls = this.#classItem;
    if (!cls) return;
    const template = (cls.system?.templates ?? []).find((t) => t.rollMin === this.binding.templateMin) ?? null;
    // The questions were asked HERE, so the apply is told the answers rather
    // than asked to collect them a second time in a dialog of its own.
    const applied = await applyClass(this.actor, cls, {
      level: this.binding.level,
      confirm: false,
      rebuildVitals: true,
      grantAwards: true,
      answers: this.binding.answers,
    });
    if (!applied?.applied) return;
    const intScore = Number(this.actor.system?.scores?.int?.value) || 0;
    const bonus = grantableRefs(this.binding.bonusPicks);
    if (template) {
      // The merging half of chargen — no wipe, so what the character already
      // owns stays. `applyTemplate` grants a printed rank as N copies by
      // design, so a package added to a character who already holds its
      // proficiencies doubles them; that is why the package is opt-in and the
      // panel says it adds.
      await applyTemplate(this.actor, cls, template, { generalRefs: bonus, intScore });
    } else if (bonus.length) {
      // No package, so the Intellect picks land on their own. Deduped by ref
      // like every other grant, so one the character already holds costs
      // nothing.
      const stray = [];
      for (const ref of bonus) await grantAbility(this.actor, ref, stray);
    }
    ui.notifications?.info(loc("assign.done", { name: this.actor.name, class: cls.name, level: this.binding.level }));
  }
}

/** Open the class picker for one character. A world with no class documents
 *  says so rather than opening an empty window. */
export async function openClassPicker(actor) {
  if (!classItems().length) {
    ui.notifications?.info(loc("pick.empty"));
    return;
  }
  return new ClassAssignApp({ actor }).render(true);
}

/** Bind a class DROPPED on a sheet: the same window, opened on that class. */
export async function openClassPickerFor(actor, classItem) {
  const app = new ClassAssignApp({ actor });
  app.binding.classUuid = classItem.uuid;
  // A dropped class the offer list would have hidden still has to be visible in
  // the selector it lands in.
  app.binding.showAll = true;
  return app.render(true);
}
