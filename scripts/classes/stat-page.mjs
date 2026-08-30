/* global game, ui, Hooks, foundry, document, console */
/**
 * Character generation, on the page that was already doing half of it.
 *
 * The system's Scores Generator rolls the six attributes, a 3d6 template die
 * and starting gold. Three things were wrong with that: nothing could be taken
 * back once rolled, the dice were offered without the rule that governs them —
 * every row carried all three formulas, unlimited, with no minimums — and the
 * template die was rolled, shown, and then DISCARDED on save, core's submit
 * handler writing the scores and the gold and never reading `scores.template`.
 * So the number that decides a character's starting package was a decoration.
 *
 * This adds the missing half in place rather than in a second window, and lays
 * the page out in the order a character is actually built: the attributes and
 * the rule they are rolled under on the left, the class and the template die it
 * is read against in the middle, what that leaves to choose and what it comes
 * to on the right.
 *
 * INJECTED, REBUILT ON CHANGE. Core is an unmodifiable reference and its submit
 * handler is a private static, so nothing here subclasses it. Its roll actions
 * ARE reachable — they hang off the instance's own options — and are wrapped
 * there, because a roll writes its result straight onto a readonly input after
 * awaiting the dice: no event fires, and any fixed delay is a race with the
 * animation. Each injected box is written only when its markup differs from
 * what is on screen, so nothing flickers and nothing loses focus.
 *
 * The picks are read off the form when it is submitted and applied when the
 * window closes, which is the only point at which core's own write of the
 * scores is known to have landed: the character's Intellect has to be on the
 * actor before the bonus proficiencies are counted against it.
 *
 * ONE OF THE TWO FAMILY DRESSINGS REACHES THIS PAGE. Its root carries
 * `acks2 stat-gen-app acks-ui`: no `.acks`, so the sheet theme's field rule
 * never applies, but the vendored `.acks-ui` one does — and that rule claims
 * `background`, `border`, `border-radius`, `color`, `font-size`, `font-family`
 * and `padding` on selects at (0,2,1). The block's own select rule leads with
 * its module class and clears it; do not weaken that selector on the
 * assumption that nothing is competing.
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { classItems, byBookOrder } from "./registry.mjs";
import { legalTemplates, netBonusPicks, templateShortfall, applyChargen } from "./chargen.mjs";
import { choosableGenerals, refOf } from "./grants.mjs";
import { classPanelHtml, picksPanelHtml, templatePanelHtml } from "./panels.mjs";
import { rungLabel, rungOptions } from "./picks.mjs";
import { makeLoc } from "../lib/util.mjs";

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

/** The module's scroll contract (styles/lib.css) — what keeps a window's own
 *  content reachable once it is taller than the screen. */
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
 * `standard` is the printed method (RR Ch. 1 §I.2): one attribute on 5d6 drop
 * two — raised to 13 if it comes up short — two more on 4d6 drop one, raised to
 * 9, and 3d6 for the remaining three. The player chooses WHICH attribute gets
 * which, so the rule is an allowance rather than a fixed order. The other three
 * are the Judges Journal's options (JJ Ch. 16, Generating Attributes): one
 * formula for every attribute, and no minimum.
 *
 * The formulas are core's own — the page's buttons carry them as `data-formula`
 * — so nothing here decides how dice are thrown, only how many times.
 */
export const METHODS = {
  standard: { allowance: { "5d6kh3": 1, "4d6kh3": 2, "3d6": 3 }, minimum: { "5d6kh3": 13, "4d6kh3": 9 } },
  gritty: { only: "3d6" },
  heroic: { only: "4d6kh3" },
  legendary: { only: "5d6kh3" },
};

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
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

/** The campaign's generation rule, falling back to the printed one. */
const currentMethod = () => {
  const key = game.settings?.get?.(MODULE_ID, METHOD_SETTING);
  return METHODS[key] ? key : "standard";
};

/**
 * Requirements this class states that these scores do not meet.
 *
 * A score that has not been rolled is UNKNOWN, never zero: it fails nothing,
 * the same way an unrolled template die legalises no package rather than
 * disqualifying every one. Reading absence as zero withheld every class with
 * a printed minimum until the deciding die was thrown, and said nothing about
 * having done so.
 */
export function unmetRequirements(classItem, scores) {
  return (classItem.system?.requirements ?? []).filter((r) => {
    if (!r.attr || typeof r.min !== "number") return false;
    const score = scores[r.attr];
    return typeof score === "number" && score < r.min;
  });
}

/**
 * Is this level-1 offer one the chosen template has already answered?
 *
 * A starting template arrives "with weapons, armor, equipment, proficiencies,
 * and spells ready for play" (RR Ch. 2), and the Intellect bonus is chosen "on
 * top of those listed for the template" — so the level-1 proficiency picks are
 * the template's to make, and asking for them beside it hands out two
 * proficiencies the character never earned. A pick among NAMED alternatives (a
 * warlock's dark path, a witch's tradition) is not a proficiency the template
 * lists, and stays on offer.
 */
const answeredByTemplate = (award) => ["classInventory", "generalList"].includes(award?.choice?.from);

/* -------------------------------------------- */
/*  The generation rule                          */
/* -------------------------------------------- */

/**
 * Offer only the dice the campaign's rule still allows.
 *
 * Under the printed method each formula has an allowance, and a row that has
 * already claimed one gives it back when it claims another — the book lets the
 * player decide which attribute gets the good dice, not which order they are
 * thrown in. Under a Judges Journal option there is one formula and no limit.
 * A Judge override lifts all of it.
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
 * Raise a score the printed method sets a floor under.
 *
 * The modifier beside it is core's to write and it wrote the one belonging to
 * the roll, so it is re-derived — by asking the actor's own data model rather
 * than by carrying a copy of the book's table, which no repo in this family
 * ships. If that cannot be reached the box is left blank, which is honest; the
 * character sheet computes the real one the moment the scores are saved.
 */
function raiseToMinimum(root, actor, key, minimum) {
  const input = root.querySelector(`input[name="scores.${key}"]`);
  if (!input || Number.isNaN(input.valueAsNumber) || input.valueAsNumber >= minimum) return false;
  input.value = minimum;
  const mod = root.querySelector(`input[name="scores.${key}.mod"]`);
  if (mod) {
    let derived = "";
    try {
      const probe = actor.clone({}, { keepId: false });
      probe.system.scores[key].value = minimum;
      probe.computeModifiers();
      const value = probe.system.scores[key].mod;
      // The box is `type="number"`, so it is written UNSIGNED, as core writes
      // the ones beside it: a leading "+" fails the value sanitisation every
      // number input applies and lands as an empty box.
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
}

/**
 * Rebuild every injected box, and every pick the class and template imply.
 *
 * Called on every change the page can make, because all of it is downstream of
 * the scores: the classes a character QUALIFIES for, how many bonus
 * proficiencies their Intellect buys, and which templates the die reaches.
 */
function refresh(root, state) {
  if (!root.querySelector(`.${CLASSBOX}`)) return;
  const scores = scoresOn(root);
  const rolled = templateRollOn(root);
  const isGM = game.user.isGM;
  const judge = isGM && state.judge;
  // Building without a package at all (JJ Ch. 16) — a Judge's option, so it is
  // only reachable behind the override.
  const manual = judge && state.manual;
  const method = currentMethod();

  const all = classItems().sort(byBookOrder);
  const qualified = all.filter((c) => !unmetRequirements(c, scores).length);
  const offered = judge ? all : qualified;

  // A class the scores no longer qualify for stops being the selection rather
  // than sitting there unreachable.
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

  // The class and template boxes are the same two the class picker shows
  // (panels.mjs) — this page adds the Judge's own row above them, which is the
  // one thing a picker has no use for.
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
      ruleHint: manual ? loc("chargen.manualRule") : rolled == null ? loc("chargen.rollFirst") : loc("chargen.rule"),
      shortfall: short,
    }),
  );

  /* --- column three: what is left to choose --- */

  const awards = (cls?.system?.awards ?? []).filter((a) => a.atLevel === 1 && a.kind === "choice");
  const asked = template ? awards.filter((a) => !answeredByTemplate(a)) : awards;
  const generalOptions = choosableGenerals()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((i) => ({ ref: refOf(i), name: i.name }));

  // A character being generated owns nothing yet, so no rung here is offered
  // the "already on the sheet" answer — there is no sheet to have it on. The
  // picker binding a played character passes true (assign-app.mjs).
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
      // The printed encumbrance parenthetical belongs with what the character
      // is carrying, which is the column that totals them up.
      trailer: template?.enc ? `<p class="hint">${esc(loc("chargen.templateEnc", { enc: template.enc }))}</p>` : "",
    }),
  );

  // The template names the coin its character starts with, so the page's gold
  // row shows what the chosen package pays instead of a figure rolled beside
  // it. Written only when the chosen template CHANGES, so a Judge's own number
  // stands until they choose a different package.
  const stamp = manual ? "manual" : template ? `${cls?.uuid}|${template.rollMin}` : "";
  if (stamp !== state.templateStamp) {
    state.templateStamp = stamp;
    const gold = root.querySelector('input[name="scores.gold"]');
    if (gold) gold.value = template ? (template.gp ?? "") : "";
  }

  // Coin is the package's to pay, so it is not rolled beside it. Building
  // WITHOUT a package is the one case the book has a character roll for their
  // own money (3d6×10), which is the formula core's own button already carries.
  const goldButton = root.querySelector('button[data-action="rollGold"]');
  if (goldButton) {
    goldButton.disabled = !judge;
    goldButton.classList.toggle(SPENT, !judge);
    goldButton.dataset.tooltip = judge ? loc("chargen.goldRoll") : loc("chargen.goldFromTemplate");
  }

  applyRule(root, state, judge);
  applyUnlock(root, judge);
  state.cls = cls;
  state.template = template;
}

/**
 * The Judge unlock frees the fields a Judge SETS.
 *
 * Core marks every input on the page readonly in its own template and never
 * clears the attribute, so this is a DOM edit. The derived boxes stay locked:
 * `stats.*` are recomputed from the scores, and `scores.<k>.mod` is the one
 * field whose name is a path UNDER a field that submits — freeing it would put
 * both `scores.str` and `scores.str.mod` into the form data core expands.
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
 * Core prints two columns: the six attribute rows, then a stack holding the
 * summary and the template and gold dice. A third column is opened between
 * them and the template row MOVED into it, because a template die means
 * nothing until a class is chosen and everything once one is — so the class it
 * is read against belongs directly above it. What is left to choose, and what
 * the character comes to, stay together on the right.
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
  // Two rows now stand together where one used to: the die, and the package it
  // reaches. Only one of them can be called "Template".
  const dieLabel = templateGroup.querySelector("label");
  if (dieLabel) dieLabel.textContent = loc("chargen.templateDie");
  panel.append(box(CLASSBOX), templateGroup, box(TPLBOX));
  middle.appendChild(panel);
  scoresPanel.insertAdjacentElement("afterend", middle);

  scoresPanel.prepend(box(RULES));
  statsPanel.parentElement.prepend(box(`standard-form panel ${PICKS}`));
  // The sum, the average and the spread describe the roll rather than the
  // character, and the rule that governs the roll is now stated where it is
  // rolled. The panel is HIDDEN, not removed: core writes into those three
  // boxes from a private method after every score, and it does not check that
  // they are there.
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
 * actions, so a field cleared here would otherwise leave the three summary
 * boxes describing scores that are gone.
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

function inject(app, root, state) {
  // Our own marker on the page root. The page's own classes are `acks2` and
  // `stat-gen-app`, neither of which this module may write rules against
  // (CSS here is namespaced `acks-extras-`), so the styles that lay the page
  // out in three columns hang off this.
  root.classList.add(PAGE_CLASS);
  if (!layout(root)) return;

  // Resets: one per score row, plus the template and gold rows. Clearing a
  // score also returns the dice it claimed to the campaign's allowance.
  for (const input of root.querySelectorAll('input[data-kind="score"]')) {
    const fields = input.closest(".form-fields");
    const key = (input.name ?? "").split(".")[1];
    // A score row carries more than core built it for, and its label is a
    // single long word. Marked so the row rule reaches it and nothing else.
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

  // Core writes a rolled value straight onto a readonly input, which fires no
  // event to listen for, and it does so only after awaiting the roll — so a
  // fixed delay is a race with however long the dice take to settle. The
  // instance's own action handlers are wrapped instead: one rebuild, after the
  // write has landed, whatever the animation cost. The handlers live on the
  // instance's options, which are frozen only at the top level.
  if (!state.wrapped) {
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

  if (!root.dataset.acksChargenBound) {
    root.dataset.acksChargenBound = "1";

    root.addEventListener("change", (event) => {
      const name = event.target?.name ?? "";
      if (name === "acks-class") state.classUuid = event.target.value;
      else if (name === "acks-template") state.templateMin = Number(event.target.value);
      else if (name === "acks-keep") state.keep = event.target.checked;
      else if (name === "acks-manual") state.manual = event.target.checked;
      else if (name === "acks-method") {
        // The generation rule is the campaign's, not this character's, so it
        // is written where the campaign keeps its rules. Only a Judge can.
        game.settings
          .set(MODULE_ID, METHOD_SETTING, event.target.value)
          .catch((err) => console.warn(`${MODULE_ID} | generation rule not saved`, err));
      } else if (name === "acks-judge") {
        state.judge = event.target.checked;
        // Remembered on the Judge's own user document, so the unlock comes
        // back the next time they open the page. Fire and forget: a write that
        // fails costs the memory, never the toggle.
        game.user
          .setFlag(MODULE_ID, JUDGE_FLAG, state.judge)
          .catch((err) => console.warn(`${MODULE_ID} | judge unlock not remembered`, err));
      } else if (name.startsWith("acks-award-")) state.awardPicks[Number(name.slice(11))] = event.target.value;
      else if (name.startsWith("acks-bonus-")) state.bonusPicks[Number(name.slice(11))] = event.target.value;
      else if (name.startsWith("scores.")) {
        // A score set by hand leaves its modifier box describing the roll it
        // replaced, and owes nothing to the campaign's dice allowance.
        const mod = root.querySelector(`input[name="${name}.mod"]`);
        if (mod) mod.value = "";
        delete state.rolledWith[name.split(".")[1]];
        recomputeStats(root);
      }
      refresh(root, state);
    });

    // Read the picks at SUBMIT and apply them at CLOSE. Core's handler writes
    // the scores; the Intellect that decides the bonus proficiencies has to be
    // on the actor before they are counted, and close is the first moment that
    // write is known to have finished.
    //
    // The application's own element IS the form (core declares `tag: "form"`),
    // so there is no descendant to find.
    const form = root.querySelector("form") ?? (root.tagName === "FORM" ? root : null);
    form?.addEventListener(
      "submit",
      () => {
        // The flag is set before anything that could throw: a character half
        // read is still a character to build.
        state.submitted = true;
        // The page AS SUBMITTED is the authority on what was chosen. Reading
        // it again here costs nothing when nothing moved, and it is what keeps
        // a choice from depending on which refresh happened to run last.
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
        // Core's own submit hands the gold field to the system's coin
        // bookkeeping. Whatever is about to pay this character — a package or a
        // 3d6×10 roll — would then pay them twice, so the field is cleared and
        // chargen stays the single writer.
        if (field && state.cls && (state.template || state.manual)) field.value = "";
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

/** Register the Scores Generator injection (once, from classes/module.mjs). */
export function registerChargenPage() {
  // Core builds this page fixed at 680 wide and NOT resizable, and its resize
  // handle is created once — while the frame is built, from the option. So the
  // option is set BEFORE the frame exists: `preRender` runs ahead of the frame,
  // and the frame update reads the render options first, so both are set. The
  // page is recognised by what it DOES, exactly as its DOM is.
  Hooks.on("preRenderApplicationV2", (app, _context, options) => {
    try {
      if (game.system?.id !== "acks" || !options?.isFirstRender) return;
      if (!app.options?.actions?.rollTemplate || !app.options?.window) return;
      app.options.window.resizable = true;
      if (options.window) options.window.resizable = true;
      // The render options ARE the application's live position, so this is the
      // only reachable place to widen it — `app.options.position` was copied
      // out at construction. Three columns do not fit in the two the page was
      // built for.
      // The height is left as core set it — `auto`, so the window is exactly
      // as tall as the build it is showing, and the handle is there for anyone
      // who wants it otherwise.
      if (options.position) options.position.width = Math.max(Number(options.position.width) || 0, 1100);
      // …but `auto` only sizes to content while the content FITS. Past the
      // screen the window stops growing and core's
      // `.application .window-content { overflow: hidden }` amputates the rest,
      // and the third column — which carries the Intellect bonus picks, the
      // last thing on the page — is what falls off. Measured on the live page:
      // the generator's window-content computes `overflow-y: hidden` and does
      // not scroll. `acks-extras-scroll` is the module's own contract for
      // exactly this (styles/lib.css) and is what the module's dialogs use, so
      // the page borrows it rather than growing a second answer.
      if (Array.isArray(app.options.classes) && !app.options.classes.includes(SCROLL_CLASS)) {
        app.options.classes.push(SCROLL_CLASS);
      }
    } catch (err) {
      console.warn(`${MODULE_ID} | could not make the Scores Generator resizable`, err);
    }
  });

  Hooks.on("renderApplicationV2", (app, element) => {
    try {
      if (game.system?.id !== "acks") return;
      const root = element instanceof HTMLElement ? element : element?.[0];
      if (!root || !isStatPage(root)) return;
      const actor = app.options?.actor ?? app.actor ?? null;
      if (!actor?.isOwner) return;
      if (!classItems().length) return;

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
          submitted: false,
          roll: null,
          gold: null,
          html: {},
          templateStamp: "",
          wrapped: false,
        };
        states.set(app, state);
      }
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
      // A build with no package is a deliberate choice, not an unfinished one.
      if (!state.cls || (!state.template && !state.manual)) {
        ui.notifications?.info(loc("chargen.nothingApplied"));
        return;
      }
      await applyChargen(state.actor, state.cls, state.template, {
        generalRefs: state.bonusPicks,
        awardPicks: state.awardPicks,
        roll: state.roll,
        gold: state.gold,
        wipe: !state.keep,
      });
    } catch (err) {
      console.error("acks-extras | applying chargen failed", err);
      ui.notifications?.error(loc("chargen.failed"));
    }
  });
}
