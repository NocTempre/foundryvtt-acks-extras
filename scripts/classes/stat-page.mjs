/* global game, ui, Hooks, foundry, document, console, Roll */
/**
 * Character generation, injected into the system's Scores Generator page in
 * three columns: the attributes and the rule they are rolled under, the class
 * and the template die it is read against, then what is left to choose. See
 * docs/classes/DECISIONS.md, "Chargen lives on the Scores Generator, not in a
 * window of its own".
 *
 * Core's submit handler is a private static, so nothing here subclasses it. Its
 * roll actions hang off the instance's own options and are wrapped there: a roll
 * writes its result onto a readonly input after awaiting the dice, so no event
 * fires and a fixed delay would race the animation. Each injected box is
 * written only when its markup differs from what is on screen, so nothing
 * flickers or loses focus.
 *
 * The picks are read off the form on submit and applied when the window closes,
 * the point at which core's own write of the scores has landed: Intellect has to
 * be on the actor before the bonus proficiencies are counted against it.
 *
 * The page root carries `acks2 stat-gen-app acks-ui`, no `.acks`, so the
 * vendored `.acks-ui` field rule applies to selects at (0,2,1). The block's own
 * select rule leads with its module class to clear it; never weaken that selector.
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { classItems, byBookOrder } from "./registry.mjs";
import { legalTemplates, netBonusPicks, templateShortfall, applyChargen } from "./chargen.mjs";
import { choosableGenerals, refOf } from "./grants.mjs";
import { classPanelHtml, picksPanelHtml, templatePanelHtml } from "./panels.mjs";
import { answeredByTemplate, isGranted, rungLabel, rungOptions } from "./picks.mjs";
import { templateGrantKeys } from "./template-packages.mjs";
import { elementOf, escape as esc, makeLoc } from "../lib/util.mjs";
import { associateLabels } from "../lib/a11y.mjs";
import { whenReady } from "../lib/library.mjs";

const PAGE_CLASS = "acks-extras-classes-statgen";
const COLUMN = "acks-extras-classes-col";
const RESET = "acks-extras-classes-reset";
const SPENT = "acks-extras-classes-spent";
const SCOREROW = "acks-extras-classes-scorerow";
const STATS = "acks-extras-classes-rollstats";

/** The four injected boxes, one per thing the page has to say. */
const RULES = "acks-extras-classes-rules";
const CLASSBOX = "acks-extras-classes-chargen";
const TPLBOX = "acks-extras-classes-tplbox";
const PICKS = "acks-extras-classes-picks";

/** The module's scroll contract (styles/lib.css). */
const SCROLL_CLASS = "acks-extras-scroll";

/** Where the Judge unlock is remembered, on the Judge's own user document. */
const JUDGE_FLAG = "chargenJudgeUnlock";

/** The campaign's attribute-generation rule (a Judge's call, so world-scoped). */
export const METHOD_SETTING = "chargenAttributeMethod";

/** The fields this page rolls — freed by the Judge unlock. */
const ROLLED = 'input[data-kind="score"], input[name="scores.template"], input[name="scores.gold"]';

/**
 * How a campaign rolls attributes.
 *
 * `standard` is the printed method (RR ch. 1, Attributes): a count of rolls per
 * formula, with a floor under two of them. The player chooses which attribute
 * gets which, so the rule is an allowance, not a fixed order. The other three
 * are the Judges Journal's options (JJ ch. 16, Generating Attributes): one
 * formula for every attribute, and no minimum. The formulas are core's own
 * (`data-formula` on its roll buttons); nothing here decides how dice are
 * thrown, only how many times.
 */
export const METHODS = {
  standard: { allowance: { "5d6kh3": 1, "4d6kh3": 2, "3d6": 3 }, minimum: { "5d6kh3": 13, "4d6kh3": 9 } },
  gritty: { only: "3d6" },
  heroic: { only: "4d6kh3" },
  legendary: { only: "5d6kh3" },
};

const loc = makeLoc(LANG_PREFIX);

/* -------------------------------------------- */
/*  Reading the page                             */
/* -------------------------------------------- */

/** Is this the system's Scores Generator? Recognised by what it DOES. */
const isStatPage = (root) =>
  !!root.querySelector('button[data-action="rollTemplate"]') && !!root.querySelector('input[name="scores.template"]');

/** The attribute scores as currently entered, keyed by their score key. */
function scoresOn(root) {
  const out = {};
  for (const input of root.querySelectorAll('input[data-kind="score"]')) {
    const key = (input.name ?? "").split(".")[1];
    if (key) out[key] = Number.isNaN(input.valueAsNumber) ? null : input.valueAsNumber;
  }
  return out;
}

/** The template die as rolled, or null while it has not been. */
function templateRollOn(root) {
  const value = root.querySelector('input[name="scores.template"]')?.valueAsNumber;
  return Number.isNaN(value) ? null : value;
}

/**
 * The dice formula core's own button for `action` carries, or "" where the page
 * has no such button. Core's template names every die the page rolls, so the
 * module reads them from it rather than holding a copy.
 */
export const formulaOf = (root, action) => root.querySelector(`button[data-action="${action}"]`)?.dataset?.formula ?? "";

/** The campaign's generation rule, falling back to the printed one. */
const currentMethod = () => {
  const key = game.settings?.get?.(MODULE_ID, METHOD_SETTING);
  return METHODS[key] ? key : "standard";
};

/**
 * Requirements this class states that these scores do not meet.
 *
 * A score that has not been rolled is unknown, never zero: it fails nothing.
 */
export function unmetRequirements(classItem, scores) {
  return (classItem.system?.requirements ?? []).filter((r) => {
    if (!r.attr || typeof r.min !== "number") return false;
    const score = scores[r.attr];
    return typeof score === "number" && score < r.min;
  });
}

/**
 * Throw the template die for a character who left it unthrown, and take the
 * best package it reaches.
 *
 * The page defaults an unanswered selector to the highest band the die
 * legalises, so this only supplies the die that default is read against. A die
 * that reaches no printed band yields the lowest, never an empty package.
 *
 * @param {object} cls - the chosen class item
 * @param {string} formula - the template die, as core's roll button carried it
 *   (`state.templateFormula`); nothing is rolled where the page held none
 * @returns {Promise<{template: object|null, roll: number|null}>} null when the
 *   class prints no packages at all, which is not a skipped step.
 */
async function autoTemplate(cls, formula) {
  const templates = cls?.system?.templates ?? [];
  if (!templates.length || !formula) return { template: null, roll: null };
  const roll = await new Roll(formula).evaluate();
  const legal = legalTemplates(templates, roll.total);
  const lowest = [...templates].sort((a, b) => a.rollMin - b.rollMin)[0];
  return { template: legal[legal.length - 1] ?? lowest ?? null, roll: roll.total };
}

/* -------------------------------------------- */
/*  The generation rule                          */
/* -------------------------------------------- */

/**
 * Offer only the dice the campaign's rule still allows.
 *
 * Under the printed method each formula has an allowance, and a row that has
 * claimed one gives it back when it claims another. Under a Judges Journal
 * option there is one formula and no limit. A Judge override lifts all of it.
 */
function applyRule(root, state, judge) {
  const rule = METHODS[currentMethod()];
  for (const button of root.querySelectorAll('button[data-action="rollScore"]')) {
    const { score, formula } = button.dataset;
    let allowed = true;
    if (!judge) {
      if (rule.only) allowed = formula === rule.only;
      else {
        const spent = Object.entries(state.rolledWith).filter(([k, f]) => f === formula && k !== score).length;
        allowed = spent < (rule.allowance?.[formula] ?? 0);
      }
    }
    button.disabled = !allowed;
    button.classList.toggle(SPENT, !allowed);
  }
}

/**
 * Raise a score the printed method sets a floor under. The modifier beside it
 * is re-derived from the actor's own data model, never a copied table; if that
 * cannot be reached the box is left blank. See docs/classes/DECISIONS.md, "The
 * page is three columns, and it enforces the campaign's dice".
 */
function raiseToMinimum(root, actor, key, minimum) {
  const input = root.querySelector(`input[name="scores.${key}"]`);
  if (!input || Number.isNaN(input.valueAsNumber) || input.valueAsNumber >= minimum) return false;
  input.value = minimum;
  const mod = root.querySelector(`input[name="scores.${key}.mod"]`);
  if (mod) {
    let derived = "";
    try {
      // The system's static reader answers for a score the actor does not hold yet.
      const value = actor.system?.constructor?.getAttributeModifier?.(minimum);
      // Written unsigned: a leading "+" fails a number input's sanitisation and lands empty.
      if (Number.isFinite(value)) derived = String(value);
    } catch {
      derived = "";
    }
    mod.value = derived;
  }
  return true;
}

/* -------------------------------------------- */
/*  Rebuilding the injected boxes                */
/* -------------------------------------------- */

/** Write markup into a box only when it differs from what is on screen. */
function put(root, cls, state, html) {
  const box = root.querySelector(`.${cls}`);
  if (!box || state.html[cls] === html) return;
  state.html[cls] = html;
  box.innerHTML = html;
  // The injector lands after the render hook that binds this module's own
  // windows, so the markup written here is bound here.
  associateLabels(box);
}

/**
 * Rebuild every injected box, and every pick the class and template imply.
 *
 * Called on every change the page can make: the classes qualified for, the
 * bonus proficiencies Intellect buys and the templates the die reaches all
 * follow the scores.
 */
function refresh(root, state) {
  if (!root.querySelector(`.${CLASSBOX}`)) return;
  const scores = scoresOn(root);
  const rolled = templateRollOn(root);
  const isGM = game.user.isGM;
  const judge = isGM && state.judge;
  // Building without a package at all (JJ Ch. 16), behind the Judge override.
  const manual = judge && state.manual;
  const method = currentMethod();
  state.templateFormula = formulaOf(root, "rollTemplate");

  const all = classItems().sort(byBookOrder);
  const qualified = all.filter((c) => !unmetRequirements(c, scores).length);
  const offered = judge ? all : qualified;

  // A class the scores no longer qualify for stops being the selection.
  if (!offered.some((c) => c.uuid === state.classUuid)) state.classUuid = offered[0]?.uuid ?? "";
  const cls = offered.find((c) => c.uuid === state.classUuid) ?? null;

  const templates = manual ? [] : (cls?.system?.templates ?? []);
  const legal = judge ? [...templates].sort((a, b) => a.rollMin - b.rollMin) : legalTemplates(templates, rolled ?? -1);
  if (!legal.some((t) => t.rollMin === state.templateMin)) state.templateMin = legal[legal.length - 1]?.rollMin ?? null;
  const template = legal.find((t) => t.rollMin === state.templateMin) ?? null;

  const intScore = scores.int ?? 0;
  const assumed = cls?.system?.templatesAssumeIntBonus ?? 0;
  const picks = netBonusPicks(intScore, assumed);
  const short = templateShortfall(intScore, assumed);
  const unmet = cls ? unmetRequirements(cls, scores) : [];

  /* --- column one: the rule the attributes are rolled under --- */

  const rule = METHODS[method];
  const remaining = rule.allowance
    ? Object.entries(rule.allowance)
        .map(([formula, cap]) => {
          const spent = Object.values(state.rolledWith).filter((f) => f === formula).length;
          return `${formula.replace("kh3", "")}×${Math.max(0, cap - spent)}`;
        })
        .join("  ")
    : "";

  put(
    root,
    RULES,
    state,
    `<div class="form-group">
       <label>${esc(loc("chargen.method"))}</label>
       <div class="form-fields">
         <select name="acks-method"${isGM ? "" : " disabled"}>${Object.keys(METHODS)
           .map((k) => `<option value="${k}"${k === method ? " selected" : ""}>${esc(loc(`chargen.methods.${k}`))}</option>`)
           .join("")}</select>
       </div>
       <p class="hint">${esc(loc(`chargen.methodHint.${method}`))}${
         remaining && !judge ? ` — ${esc(loc("chargen.remaining", { parts: remaining }))}` : ""
       }</p>
     </div>`,
  );

  /* --- column two: the class, then the die read against it --- */

  // The class and template boxes are the picker's (panels.mjs); this page adds
  // the Judge's row above them.
  put(
    root,
    CLASSBOX,
    state,
    classPanelHtml({
      offered,
      selectedUuid: state.classUuid,
      unmet,
      controls: isGM
        ? `<div class="form-group">
             <label class="checkbox" data-tooltip="${esc(loc("chargen.judgeUnlockHint"))}"><input type="checkbox" name="acks-judge"${
               state.judge ? " checked" : ""
             } /> ${esc(loc("chargen.judgeUnlock"))}</label>
             ${
               judge
                 ? `<label class="checkbox" data-tooltip="${esc(loc("chargen.manualHint"))}"><input type="checkbox" name="acks-manual"${
                     state.manual ? " checked" : ""
                   } /> ${esc(loc("chargen.manual"))}</label>
                    <label class="checkbox" data-tooltip="${esc(loc("chargen.keepHint"))}"><input type="checkbox" name="acks-keep"${
                      state.keep ? " checked" : ""
                    } /> ${esc(loc("chargen.keep"))}</label>`
                 : ""
             }
           </div>`
        : "",
    }),
  );

  put(
    root,
    TPLBOX,
    state,
    templatePanelHtml({
      legal,
      selectedMin: state.templateMin,
      template,
      // A class that prints no packages is answered before the die: the box has
      // nothing to put in it, and the Judge override reaches the same empty array.
      ruleHint: manual
        ? loc("chargen.manualRule")
        : cls && !templates.length
          ? loc("chargen.noTemplates")
          : rolled == null
            ? loc("chargen.rollFirst")
            : loc("chargen.rule"),
      shortfall: short,
    }),
  );

  /* --- column three: what is left to choose --- */

  const awards = (cls?.system?.awards ?? []).filter((a) => a.atLevel === 1 && a.kind === "choice");
  const asked = template ? awards.filter((a) => !answeredByTemplate(a)) : awards;
  // The Intellect picks are in addition to the template's own list (RR p. 23),
  // but exclude an ability the package hands over.
  const granted = template ? templateGrantKeys(template) : null;
  const generalOptions = choosableGenerals()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((i) => ({ ref: refOf(i), name: i.name }))
    .filter((o) => !isGranted(granted, o));

  // No rung here is offered the "already on the sheet" answer; the picker
  // binding a played character passes true (assign-app.mjs).
  put(
    root,
    PICKS,
    state,
    picksPanelHtml({
      rungs: asked.map((a, i) => ({
        name: `acks-award-${i}`,
        label: rungLabel(a, "levelup.pick"),
        options: rungOptions(a.choice, cls),
        selected: state.awardPicks[i] ?? "",
      })),
      bonus: Array.from({ length: picks }, (_, i) => ({
        name: `acks-bonus-${i}`,
        label: loc("chargen.bonusPick", { n: i + 1 }),
        options: generalOptions,
        selected: state.bonusPicks[i] ?? "",
      })),
      // The printed encumbrance parenthetical sits with what the character carries.
      trailer: template?.enc ? `<p class="hint">${esc(loc("chargen.templateEnc", { enc: template.enc }))}</p>` : "",
    }),
  );

  // The gold row shows what the chosen package pays, written only when the
  // chosen template changes so a Judge's own number stands.
  const stamp = manual ? "manual" : template ? `${cls?.uuid}|${template.rollMin}` : "";
  if (stamp !== state.templateStamp) {
    state.templateStamp = stamp;
    const gold = root.querySelector('input[name="scores.gold"]');
    if (gold) gold.value = template ? (template.gp ?? "") : "";
  }

  // Coin is the package's to pay; only building without a package rolls for it
  // (RR ch. 1), with the formula core's own button carries.
  const goldButton = root.querySelector('button[data-action="rollGold"]');
  if (goldButton) {
    goldButton.disabled = !judge;
    goldButton.classList.toggle(SPENT, !judge);
    const goldFormula = goldButton.dataset.formula ?? "";
    goldButton.dataset.tooltip = !judge
      ? loc("chargen.goldFromTemplate")
      : goldFormula
        ? loc("chargen.goldRoll", { formula: goldFormula })
        : loc("chargen.goldRollPlain");
  }

  applyRule(root, state, judge);
  applyUnlock(root, judge);
  state.cls = cls;
  state.template = template;
  // What the page is offering: the manual tick counts only while the override
  // is up. Never read `state.manual` outside this function.
  state.manualInForce = manual;
}

/**
 * The Judge unlock frees the fields a Judge SETS.
 *
 * Core marks every input readonly in its template and never clears it, so this
 * is a DOM edit. The derived boxes stay locked: `stats.*` are recomputed, and
 * freeing `scores.<k>.mod`, a path under a field that submits, would put both
 * `scores.str` and `scores.str.mod` into the form data core expands.
 */
function applyUnlock(root, on) {
  for (const el of root.querySelectorAll(ROLLED)) el.toggleAttribute("readonly", !on);
}

/* -------------------------------------------- */
/*  Injection                                    */
/* -------------------------------------------- */

/**
 * Lay the page out in the order a character is built.
 *
 * Core prints the six attribute rows, then a stack holding the summary and the
 * template and gold dice. A middle column is opened between them and the
 * template row moved into it beneath the class it is read against; what is
 * left to choose stays on the right.
 *
 * Idempotent: the columns are built once, and the moved row is recognised by
 * where it now lives.
 */
function layout(root) {
  if (root.querySelector(`.${COLUMN}`)) return true;
  const scoresPanel = root.querySelector('input[data-kind="score"]')?.closest(".panel");
  const templateGroup = root.querySelector('input[name="scores.template"]')?.closest(".form-group");
  const statsPanel = root.querySelector('input[name="stats.sum"]')?.closest(".panel");
  if (!scoresPanel || !templateGroup || !statsPanel) return false;

  const box = (cls, tag = "div") => {
    const el = document.createElement(tag);
    el.className = cls;
    return el;
  };

  const middle = box(`standard-form ${COLUMN}`);
  const panel = box("standard-form panel");
  // The die row is relabelled, since the package box beside it is the Template.
  const dieLabel = templateGroup.querySelector("label");
  if (dieLabel) dieLabel.textContent = loc("chargen.templateDie");
  panel.append(box(CLASSBOX), templateGroup, box(TPLBOX));
  middle.appendChild(panel);
  scoresPanel.insertAdjacentElement("afterend", middle);

  scoresPanel.prepend(box(RULES));
  statsPanel.parentElement.prepend(box(`standard-form panel ${PICKS}`));
  // The summary panel is hidden, not removed: core writes into its three boxes
  // after every score without checking they exist.
  statsPanel.classList.add(STATS);
  return true;
}

/** A reset beside one rollable field: clears it and anything derived from it. */
function addReset(fields, onReset) {
  if (!fields || fields.querySelector(`.${RESET}`)) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = `plain ${RESET}`;
  button.dataset.tooltip = loc("chargen.reset");
  button.innerHTML = '<i class="fa-solid fa-rotate-left"></i>';
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onReset();
  });
  fields.appendChild(button);
}

/**
 * Recompute the page's own sum / average / spread.
 *
 * Core does this inside a private method reachable only from its own roll
 * actions.
 */
function recomputeStats(root) {
  const values = Array.from(root.querySelectorAll('input[data-kind="score"]'), (el) =>
    Number.isNaN(el.valueAsNumber) ? 0 : el.valueAsNumber,
  );
  if (!values.length) return;
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / values.length;
  const std = Math.sqrt(values.map((x) => (x - mean) ** 2).reduce((a, b) => a + b, 0) / values.length);
  const put = (name, value) => {
    const el = root.querySelector(`input[name="stats.${name}"]`);
    if (el) el.value = value;
  };
  put("sum", sum);
  put("mean", mean.toFixed(2));
  put("std", std.toFixed(2));
}

/**
 * Wrap the instance's roll actions so each roll is recorded and the injected
 * boxes rebuilt once it lands.
 *
 * Core writes a rolled value onto a readonly input after awaiting the dice and
 * fires no event, so the instance's own action handlers are wrapped: one
 * rebuild, after the write has landed. The handlers live on the instance's
 * options, frozen only at the top level.
 *
 * Runs on the first render, ahead of the library wait, so a roll thrown before
 * the injected controls arrive still counts against the dice allowance; until
 * `inject` has built the boxes, `refresh` does nothing. Idempotent per state.
 */
function wrapRolls(app, root, state) {
  if (state.wrapped) return;
  state.wrapped = true;
  try {
    for (const action of ["rollScore", "rollGold", "rollTemplate"]) {
      const original = app.options?.actions?.[action];
      if (typeof original !== "function") continue;
      app.options.actions[action] = async function wrapped(event, target) {
        await original.call(this, event, target);
        if (action === "rollScore") {
          const { score, formula } = target.dataset;
          state.rolledWith[score] = formula;
          const floor = METHODS[currentMethod()].minimum?.[formula];
          const judge = game.user.isGM && state.judge;
          if (floor && !judge && raiseToMinimum(root, state.actor, score, floor)) recomputeStats(root);
        }
        refresh(root, state);
      };
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | rolls will not refresh the chargen block`, err);
  }
}

function inject(app, root, state) {
  // The module's own marker on the page root; its styles hang off this, since
  // CSS here is namespaced `acks-extras-`.
  root.classList.add(PAGE_CLASS);
  if (!layout(root)) return;

  // Resets: one per score row, plus the template and gold rows. Clearing a
  // score also returns the dice it claimed to the campaign's allowance.
  for (const input of root.querySelectorAll('input[data-kind="score"]')) {
    const fields = input.closest(".form-fields");
    const key = (input.name ?? "").split(".")[1];
    // Marked so the score-row styles reach it and nothing else.
    fields?.parentElement?.classList.add(SCOREROW);
    addReset(fields, () => {
      input.value = "";
      const mod = fields.querySelector(`input[name="${input.name}.mod"]`);
      if (mod) mod.value = "";
      delete state.rolledWith[key];
      recomputeStats(root);
      refresh(root, state);
    });
  }
  for (const name of ["scores.template", "scores.gold"]) {
    const input = root.querySelector(`input[name="${name}"]`);
    if (!input) continue;
    addReset(input.closest(".form-fields"), () => {
      input.value = "";
      refresh(root, state);
    });
  }

  wrapRolls(app, root, state);

  if (!root.dataset.acksChargenBound) {
    root.dataset.acksChargenBound = "1";

    root.addEventListener("change", (event) => {
      const name = event.target?.name ?? "";
      if (name === "acks-class") state.classUuid = event.target.value;
      else if (name === "acks-template") state.templateMin = Number(event.target.value);
      else if (name === "acks-keep") state.keep = event.target.checked;
      else if (name === "acks-manual") state.manual = event.target.checked;
      else if (name === "acks-method") {
        // The campaign's rule, written to the world setting; only a Judge can.
        game.settings
          .set(MODULE_ID, METHOD_SETTING, event.target.value)
          .catch((err) => console.warn(`${MODULE_ID} | generation rule not saved`, err));
      } else if (name === "acks-judge") {
        state.judge = event.target.checked;
        // Remembered on the Judge's user; a failed write costs the memory, not the toggle.
        game.user
          .setFlag(MODULE_ID, JUDGE_FLAG, state.judge)
          .catch((err) => console.warn(`${MODULE_ID} | judge unlock not remembered`, err));
      } else if (name.startsWith("acks-award-")) state.awardPicks[Number(name.slice(11))] = event.target.value;
      else if (name.startsWith("acks-bonus-")) state.bonusPicks[Number(name.slice(11))] = event.target.value;
      else if (name.startsWith("scores.")) {
        // A score set by hand clears its modifier box and frees its dice allowance.
        const mod = root.querySelector(`input[name="${name}.mod"]`);
        if (mod) mod.value = "";
        delete state.rolledWith[name.split(".")[1]];
        recomputeStats(root);
      }
      refresh(root, state);
    });

    // Picks are read at submit and applied at close, once core's score write has
    // finished. The application's own element is the form (`tag: "form"`).
    const form = root.querySelector("form") ?? (root.tagName === "FORM" ? root : null);
    form?.addEventListener(
      "submit",
      () => {
        // Set before anything that could throw.
        state.submitted = true;
        // The page as submitted is the authority on what was chosen.
        try {
          refresh(root, state);
        } catch (err) {
          console.error(`${MODULE_ID} | reading the chargen page at submit failed`, err);
        }
        state.bonusPicks = Array.from(root.querySelectorAll('select[name^="acks-bonus-"]'), (el) => el.value).filter(Boolean);
        state.awardPicks = Array.from(root.querySelectorAll('select[name^="acks-award-"]'), (el) => el.value).filter(Boolean);
        state.roll = templateRollOn(root);
        const field = root.querySelector('input[name="scores.gold"]');
        const gold = field?.valueAsNumber;
        state.gold = Number.isNaN(gold) ? null : gold;
        // Core's submit hands the gold field to the system's coin bookkeeping,
        // which would pay twice beside a package or gold roll; chargen stays
        // the single writer.
        if (field && state.cls && (state.template || state.manualInForce)) field.value = "";
      },
      { capture: true },
    );
  }

  refresh(root, state);
}

/* -------------------------------------------- */
/*  Install                                      */
/* -------------------------------------------- */

/** Per-application state, so two open generators do not share a selection. */
const states = new WeakMap();

/** The chargen state of an open Scores Generator, or undefined when none is tracked for `app`. */
export const chargenStateOf = (app) => states.get(app);

/** Register the Scores Generator injection (once, from classes/module.mjs). */
export function registerChargenPage() {
  // Core builds this page fixed-width and not resizable, and creates its resize
  // handle once, while the frame is built from the option; so the option is set
  // in `preRender`, ahead of the frame, in both the options and the render
  // options.
  Hooks.on("preRenderApplicationV2", (app, _context, options) => {
    try {
      if (game.system?.id !== "acks" || !options?.isFirstRender) return;
      if (!app.options?.actions?.rollTemplate || !app.options?.window) return;
      app.options.window.resizable = true;
      if (options.window) options.window.resizable = true;
      // The render options are the live position (`app.options.position` was
      // copied at construction), so the width for three columns is set here.
      // Height stays core's `auto`.
      if (options.position) options.position.width = Math.max(Number(options.position.width) || 0, 1100);
      // `auto` sizes only while the content fits the screen; past it core's
      // `overflow: hidden` clips the third column, so the page takes the
      // module's scroll contract (styles/lib.css).
      if (Array.isArray(app.options.classes) && !app.options.classes.includes(SCROLL_CLASS)) {
        app.options.classes.push(SCROLL_CLASS);
      }
    } catch (err) {
      console.warn(`${MODULE_ID} | could not make the Scores Generator resizable`, err);
    }
  });

  Hooks.on("renderApplicationV2", async (app, element) => {
    try {
      if (game.system?.id !== "acks") return;
      const root = elementOf(element);
      if (!root || !isStatPage(root)) return;
      const actor = app.options?.actor ?? app.actor ?? null;
      if (!actor?.isOwner) return;
      // The state and the roll wrap come before the wait; `inject` arrives late.
      let state = states.get(app);
      if (!state) {
        state = {
          actor,
          classUuid: "",
          templateMin: null,
          bonusPicks: [],
          awardPicks: [],
          rolledWith: {},
          judge: !!game.user.getFlag(MODULE_ID, JUDGE_FLAG),
          keep: false,
          manual: false,
          manualInForce: false,
          submitted: false,
          roll: null,
          gold: null,
          html: {},
          templateStamp: "",
          templateFormula: "",
          wrapped: false,
        };
        states.set(app, state);
      }
      wrapRolls(app, root, state);
      // Warm unconditionally; never gate it on the library reading empty. See
      // docs/classes/DECISIONS.md, "the library is warmed unconditionally,
      // because emptiness is not coldness".
      await whenReady();
      if (!root.isConnected || !classItems().length) return;
      inject(app, root, state);
    } catch (err) {
      console.error("acks-extras | chargen page injection failed", err);
    }
  });

  Hooks.on("closeApplicationV2", async (app) => {
    const state = states.get(app);
    if (!state?.submitted) return;
    states.delete(app);
    try {
      let template = state.template;
      let roll = state.roll;
      // The die is thrown for a character who reached the end of the page
      // without it, since an unthrown die legalises no package.
      if (state.cls && !template && !state.manualInForce) {
        const auto = await autoTemplate(state.cls, state.templateFormula);
        if (auto.template) {
          template = auto.template;
          roll = auto.roll;
          ui.notifications?.info(loc("chargen.templateAutoRolled", { roll: auto.roll, name: auto.template.name }));
        }
      }
      if (!state.cls || (!template && !state.manualInForce)) {
        ui.notifications?.info(loc("chargen.nothingApplied"));
        return;
      }
      await applyChargen(state.actor, state.cls, template, {
        generalRefs: state.bonusPicks,
        awardPicks: state.awardPicks,
        roll,
        gold: state.gold,
        wipe: !state.keep,
      });
    } catch (err) {
      console.error("acks-extras | applying chargen failed", err);
      ui.notifications?.error(loc("chargen.failed"));
    }
  });
}
