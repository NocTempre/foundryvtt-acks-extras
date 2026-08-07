/* global game, ui, Hooks, foundry, document, setTimeout */
/**
 * Character generation, on the page that was already doing half of it.
 *
 * The system's Scores Generator rolls the six attributes, a 3d6 template die
 * and starting gold. Two things were wrong with that: nothing could be taken
 * back once rolled, and the template die was rolled, shown, and then DISCARDED
 * on save — core's submit handler writes the scores and the gold and never
 * reads `scores.template`. So the number that decides a character's starting
 * package was a decoration.
 *
 * This adds the missing half in place rather than in a second window: a reset
 * beside everything rollable, a class chosen after the scores are known and
 * before the template is rolled, and the template die read against that class.
 * A second dialog would have asked the same questions again and rolled a
 * second, different template die.
 *
 * INJECTED, REBUILT EVERY RENDER. Core is an unmodifiable reference, its
 * submit handler is a private static, and its actions are declared as statics
 * — so nothing here subclasses or wraps. The picks are read off the form when
 * it is submitted and applied when the window closes, which is the only point
 * at which core's own write of the scores is known to have landed: the
 * character's Intellect has to be on the actor before the bonus proficiencies
 * are counted against it.
 *
 * ONE OF THE TWO FAMILY DRESSINGS REACHES THIS PAGE. Its root carries
 * `acks2 stat-gen-app acks-ui`: no `.acks`, so the sheet theme's field rule
 * never applies, but the vendored `.acks-ui` one does — and that rule claims
 * `background`, `border`, `border-radius`, `color`, `font-size`, `font-family`
 * and `padding` on selects at (0,2,1). The block's own select rule leads with
 * its module class and clears it; do not weaken that selector on the
 * assumption that nothing is competing.
 */
import { LANG_PREFIX } from "./constants.mjs";
import { classItems } from "./registry.mjs";
import { legalTemplates, netBonusPicks, templateShortfall, applyChargen } from "./chargen.mjs";
import { optionsForChoice } from "./levelup.mjs";

const BLOCK = "acks-extras-classes-chargen";
const RESET = "acks-extras-classes-reset";
const PAGE_CLASS = "acks-extras-classes-statgen";

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const loc = (key, data) => (data ? game.i18n.format(`${LANG_PREFIX}.${key}`, data) : game.i18n.localize(`${LANG_PREFIX}.${key}`));

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

/** Requirements this class states that these scores do not meet. */
export function unmetRequirements(classItem, scores) {
  return (classItem.system?.requirements ?? []).filter(
    (r) => r.attr && typeof r.min === "number" && (scores[r.attr] ?? 0) < r.min,
  );
}

/* -------------------------------------------- */
/*  Rebuilding the injected block                */
/* -------------------------------------------- */

/**
 * Rebuild the class row, the template readout and every pick the two imply.
 *
 * Called on every change the page can make, because all of it is downstream of
 * the scores: the classes a character QUALIFIES for, how many bonus
 * proficiencies their Intellect buys, and which templates the die reaches.
 * The old wizard rebuilt on a class change but not on a template change, so
 * the picks belonged to whatever had been selected first.
 */
function refresh(root, state) {
  const box = root.querySelector(`.${BLOCK}`);
  if (!box) return;
  const scores = scoresOn(root);
  const rolled = templateRollOn(root);
  const isGM = game.user.isGM;

  const all = classItems().sort((a, b) => a.name.localeCompare(b.name));
  const qualified = all.filter((c) => !unmetRequirements(c, scores).length);
  const offered = state.judgeClasses && isGM ? all : qualified;

  // A class the scores no longer qualify for stops being the selection rather
  // than sitting there unreachable.
  if (!offered.some((c) => c.uuid === state.classUuid)) state.classUuid = offered[0]?.uuid ?? "";
  const cls = offered.find((c) => c.uuid === state.classUuid) ?? null;

  const templates = cls?.system?.templates ?? [];
  const legal = state.judgeTemplates && isGM ? [...templates].sort((a, b) => a.rollMin - b.rollMin) : legalTemplates(templates, rolled ?? -1);
  if (!legal.some((t) => t.rollMin === state.templateMin)) state.templateMin = legal[legal.length - 1]?.rollMin ?? null;
  const template = legal.find((t) => t.rollMin === state.templateMin) ?? null;

  const intScore = scores.int ?? 0;
  const assumed = cls?.system?.templatesAssumeIntBonus ?? 0;
  const picks = netBonusPicks(intScore, assumed);
  const short = templateShortfall(intScore, assumed);

  const generals = (game.items ?? [])
    .filter((i) => i.type === "ability" && i.system.proficiencytype === "general")
    .sort((a, b) => a.name.localeCompare(b.name));
  const generalOptions = generals
    .map((i) => {
      const ref = i.flags?.["acks-importer"]?.cookbook?.id ?? `uuid:${i.uuid}`;
      return `<option value="${esc(ref)}">${esc(i.name)}</option>`;
    })
    .join("");

  const awards = (cls?.system?.awards ?? []).filter((a) => a.atLevel === 1 && a.kind === "choice");

  const unmet = cls ? unmetRequirements(cls, scores) : [];

  box.innerHTML = `
    <div class="form-group">
      <label>${esc(loc("pick.class"))}</label>
      <div class="form-fields">
        <select name="acks-class">${offered
          .map((c) => `<option value="${esc(c.uuid)}"${c.uuid === state.classUuid ? " selected" : ""}>${esc(c.name)}</option>`)
          .join("")}</select>
      </div>
      ${
        isGM
          ? `<label class="checkbox"><input type="checkbox" name="acks-judge-classes"${
              state.judgeClasses ? " checked" : ""
            } /> ${esc(loc("chargen.judgeClasses"))}</label>`
          : ""
      }
      ${unmet.length ? `<p class="hint">${esc(loc("apply.unmet", { parts: unmet.map((r) => `${r.attr.toUpperCase()} ${r.min}`).join(", ")}))}</p>` : ""}
      ${!offered.length ? `<p class="hint">${esc(loc("chargen.noneQualify"))}</p>` : ""}
    </div>

    <div class="form-group">
      <label>${esc(loc("chargen.template"))}</label>
      <div class="form-fields">
        <select name="acks-template"${legal.length ? "" : " disabled"}>${legal
          .map(
            (t) =>
              `<option value="${t.rollMin}"${t.rollMin === state.templateMin ? " selected" : ""}>${esc(
                t.name + (t.annotation ? ` (${t.annotation})` : ""),
              )} [${t.rollMin}–${t.rollMax}]</option>`,
          )
          .join("")}</select>
      </div>
      ${
        isGM
          ? `<label class="checkbox"><input type="checkbox" name="acks-judge-templates"${
              state.judgeTemplates ? " checked" : ""
            } /> ${esc(loc("chargen.judgeOverride"))}</label>`
          : ""
      }
      <p class="hint">${esc(rolled == null ? loc("chargen.rollFirst") : loc("chargen.rule"))}</p>
    </div>

    ${awards
      .map((a, i) => {
        const options = optionsForChoice(a.choice, cls)
          .map((o) => `<option value="${esc(o.ref)}"${state.awardPicks[i] === o.ref ? " selected" : ""}>${esc(o.name)}</option>`)
          .join("");
        const label = a.choice.label || loc("levelup.pick");
        return `<div class="form-group"><label>${esc(label)}</label><div class="form-fields"><select name="acks-award-${i}">${options}</select></div></div>`;
      })
      .join("")}

    ${Array.from({ length: picks }, (_, i) => {
      const chosen = state.bonusPicks[i] ?? "";
      const options = generalOptions.replace(`value="${esc(chosen)}"`, `value="${esc(chosen)}" selected`);
      return `<div class="form-group"><label>${esc(loc("chargen.bonusPick", { n: i + 1 }))}</label><div class="form-fields"><select name="acks-bonus-${i}">${options}</select></div></div>`;
    }).join("")}

    ${
      // A template that prints more than this character may hold says so
      // BEFORE it is applied, not only in the chat card afterwards.
      short.profs
        ? `<p class="hint">${esc(loc("chargen.assumesInt", { profs: short.profs, spells: short.spells }))}</p>`
        : ""
    }`;

  state.cls = cls;
  state.template = template;
}

/* -------------------------------------------- */
/*  Injection                                    */
/* -------------------------------------------- */

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
  // (CSS here is namespaced `acks-extras-`), so the styles that keep the score
  // rows legible with a fourth control in them hang off this.
  root.classList.add(PAGE_CLASS);

  // Resets: one per score row, plus the template and gold rows.
  for (const input of root.querySelectorAll('input[data-kind="score"]')) {
    const fields = input.closest(".form-fields");
    addReset(fields, () => {
      input.value = "";
      const mod = fields.querySelector(`input[name="${input.name}.mod"]`);
      if (mod) mod.value = "";
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

  // The class row and everything downstream of it, seated between the scores
  // and the template die — the order the character is built in.
  const templateGroup = root.querySelector('input[name="scores.template"]')?.closest(".form-group");
  if (templateGroup && !root.querySelector(`.${BLOCK}`)) {
    const box = document.createElement("div");
    box.className = `${BLOCK} standard-form panel`;
    templateGroup.parentElement.insertBefore(box, templateGroup);
  }

  // Core writes a rolled value straight onto a readonly input, which fires no
  // event — so the page is re-read after any of its own roll buttons resolve.
  // The action handler is private and cannot be wrapped; the click can.
  if (!root.dataset.acksChargenBound) {
    root.dataset.acksChargenBound = "1";
    root.addEventListener("click", (event) => {
      if (!event.target.closest('[data-action^="roll"]')) return;
      // Core's handler awaits the roll, so re-read on a few settling frames
      // rather than immediately. Cheap, and it cannot miss a slow evaluation.
      for (const delay of [0, 150, 400, 800]) setTimeout(() => refresh(root, state), delay);
    });
    root.addEventListener("change", (event) => {
      const name = event.target?.name ?? "";
      if (name === "acks-class") state.classUuid = event.target.value;
      else if (name === "acks-template") state.templateMin = Number(event.target.value);
      else if (name === "acks-judge-classes") state.judgeClasses = event.target.checked;
      else if (name === "acks-judge-templates") state.judgeTemplates = event.target.checked;
      else if (name.startsWith("acks-award-")) state.awardPicks[Number(name.slice(11))] = event.target.value;
      else if (name.startsWith("acks-bonus-")) state.bonusPicks[Number(name.slice(11))] = event.target.value;
      else if (name.startsWith("scores.")) recomputeStats(root);
      refresh(root, state);
    });

    // Read the picks at SUBMIT and apply them at CLOSE. Core's handler writes
    // the scores; the Intellect that decides the bonus proficiencies has to be
    // on the actor before they are counted, and close is the first moment that
    // write is known to have finished.
    const form = root.querySelector("form") ?? (root.tagName === "FORM" ? root : null);
    form?.addEventListener(
      "submit",
      () => {
        state.submitted = true;
        state.bonusPicks = Array.from(root.querySelectorAll('select[name^="acks-bonus-"]'), (el) => el.value).filter(Boolean);
        state.awardPicks = Array.from(root.querySelectorAll('select[name^="acks-award-"]'), (el) => el.value).filter(Boolean);
        state.roll = templateRollOn(root);
      },
      { capture: true },
    );
  }

  refresh(root, state);
  void app;
}

/* -------------------------------------------- */
/*  Install                                      */
/* -------------------------------------------- */

/** Per-application state, so two open generators do not share a selection. */
const states = new WeakMap();

/** Register the Scores Generator injection (once, from classes/module.mjs). */
export function registerChargenPage() {
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
        state = { actor, classUuid: "", templateMin: null, bonusPicks: [], awardPicks: [], judgeClasses: false, judgeTemplates: false, submitted: false, roll: null };
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
      if (!state.cls || !state.template) {
        ui.notifications?.info(loc("chargen.nothingApplied"));
        return;
      }
      await applyChargen(state.actor, state.cls, state.template, {
        generalRefs: state.bonusPicks,
        awardPicks: state.awardPicks,
        roll: state.roll,
      });
    } catch (err) {
      console.error("acks-extras | applying chargen failed", err);
      ui.notifications?.error(loc("chargen.failed"));
    }
  });
}
