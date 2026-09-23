/* global foundry, game, ui, fromUuid */
/**
 * The repair window: every registered check, grouped by feature, with what its
 * last scan found and what its last fix did. It writes nothing itself — "Fix
 * selected" hands the chosen findings to `fixRepairs`, which fixes them from a
 * fresh scan and rescans — and it holds no state a re-render can lose: the
 * scans, the outcomes and the picks live on the instance. One window per
 * world, however it was opened.
 */
import { MODULE_ID, LANG_PREFIX } from "../constants.mjs";
import { makeLoc } from "../util.mjs";
import { failureText, fixRepairs, postRepairReport, repairChecks, scanRepairs } from "../repair.mjs";

const { HandlebarsApplicationMixin, ApplicationV2, DialogV2 } = foundry.applications.api;
const loc = makeLoc(LANG_PREFIX);

/** A pick names a finding across checks. Check ids hold no `|`, so the first one splits it. */
const pickOf = (checkId, key) => `${checkId}|${key}`;
const splitPick = (pick) => [pick.slice(0, pick.indexOf("|")), pick.slice(pick.indexOf("|") + 1)];

let instance = null;

/** The repair window. */
export class RepairApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "acks-extras-repair",
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-extras-repair"],
    position: { width: 720, height: 640 },
    window: { title: `${LANG_PREFIX}.repair.title`, icon: "fa-solid fa-screwdriver-wrench", resizable: true },
    actions: {
      scanAll: RepairApp.#onScanAll,
      scanOne: RepairApp.#onScanOne,
      fixSelected: RepairApp.#onFixSelected,
      openSubject: RepairApp.#onOpenSubject,
    },
  };

  // The body is its own scroller so a re-render after a scan keeps its place;
  // the footer is a second part so the fix button never scrolls away.
  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/lib/repair.hbs`, scrollable: [""] },
    footer: { template: `modules/${MODULE_ID}/templates/lib/repair-footer.hbs` },
  };

  /** check id → its last scan `{findings, error}`. */
  #scans = new Map();
  /** check id → its last fix outcome. */
  #outcomes = new Map();
  /** Picked findings, as `pickOf` spells them. */
  #picked = new Set();
  /** The check ids this window shows, or null for all. */
  #only = null;
  #busy = false;

  constructor(options = {}) {
    super(options);
    this.#only = Array.isArray(options.only) && options.only.length ? [...options.only] : null;
  }

  /** Limit the window to `only` (null for every check) and redraw it. */
  showOnly(only) {
    this.#only = Array.isArray(only) && only.length ? [...only] : null;
    return this.render(true);
  }

  /** @override */
  async _prepareContext() {
    const live = new Set();
    const groups = new Map();
    for (const check of repairChecks({ only: this.#only })) {
      const scan = this.#scans.get(check.id) ?? null;
      const outcome = this.#outcomes.get(check.id) ?? null;
      const findings = (scan?.findings ?? []).map((f) => {
        const pick = pickOf(check.id, f.key);
        if (f.fixable) live.add(pick);
        return { ...f, pick, checked: this.#picked.has(pick) };
      });
      const row = {
        id: check.id,
        label: game.i18n.localize(check.label),
        hint: check.hint ? game.i18n.localize(check.hint) : "",
        reportOnly: !check.fix,
        scanned: !!scan,
        error: scan?.error ?? null,
        findings,
        anyFixable: findings.some((f) => f.fixable),
        outcome: outcome && {
          fixed: outcome.fixed.map((f) => ({ name: f.name, text: f.summary || f.detail })),
          failed: outcome.failed.map((f) => ({ name: f.name, text: failureText(f) })),
          counts: loc("repair.report.counts", { fixed: outcome.fixed.length, failed: outcome.failed.length }),
        },
      };
      if (!groups.has(check.feature)) groups.set(check.feature, { label: loc(`repair.feature.${check.feature}`), checks: [] });
      groups.get(check.feature).checks.push(row);
    }
    // A pick outlives its finding once a rescan stops reporting it.
    for (const pick of [...this.#picked]) if (!live.has(pick)) this.#picked.delete(pick);
    return {
      groups: [...groups.values()],
      busy: this.#busy,
      nonePicked: !this.#picked.size || this.#busy,
      pickedLabel: loc("repair.picked", { count: this.#picked.size }),
    };
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener("change", (event) => this.#onPick(event));
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    if (instance === this) instance = null;
  }

  /** A checkbox changed: one finding, or every fixable finding of a check. */
  #onPick(event) {
    const box = event.target;
    if (!(box instanceof HTMLInputElement) || box.type !== "checkbox") return;
    if (box.dataset.pick) {
      if (box.checked) this.#picked.add(box.dataset.pick);
      else this.#picked.delete(box.dataset.pick);
    } else if (box.dataset.pickAll) {
      for (const row of this.element.querySelectorAll(`[data-check="${box.dataset.pickAll}"] input[data-pick]`)) {
        row.checked = box.checked;
        if (box.checked) this.#picked.add(row.dataset.pick);
        else this.#picked.delete(row.dataset.pick);
      }
    } else return;
    this.render({ parts: ["footer"] });
  }

  /** Scan `ids` (null: every check this window shows), then redraw. */
  async #scan(ids) {
    if (this.#busy) return;
    this.#busy = true;
    await this.render({ parts: ["footer"] });
    try {
      for (const result of await scanRepairs({ only: ids ?? this.#only })) {
        this.#scans.set(result.id, result);
        this.#outcomes.delete(result.id);
      }
    } catch (err) {
      ui.notifications.error(err.message);
    } finally {
      this.#busy = false;
      this.render();
    }
  }

  static async #onScanAll() {
    await this.#scan(null);
  }

  static async #onScanOne(_event, target) {
    await this.#scan([target.dataset.check]);
  }

  static async #onFixSelected() {
    if (this.#busy || !this.#picked.size) return;
    const byCheck = new Map();
    for (const pick of this.#picked) {
      const [id, key] = splitPick(pick);
      byCheck.set(id, [...(byCheck.get(id) ?? []), key]);
    }
    const count = this.#picked.size;
    const confirmed = await DialogV2.confirm({
      window: { title: loc("repair.confirmTitle") },
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      content: `<p>${foundry.utils.escapeHTML(loc("repair.confirm", { count }))}</p>`,
    });
    if (!confirmed) return;
    this.#busy = true;
    await this.render({ parts: ["footer"] });
    const outcomes = [];
    try {
      for (const [id, keys] of byCheck) {
        const outcome = await fixRepairs(id, keys, { report: false });
        this.#outcomes.set(id, outcome);
        this.#scans.set(id, outcome.rescan);
        outcomes.push(outcome);
      }
      if (outcomes.some((o) => o.fixed.length || o.failed.length)) await postRepairReport(outcomes);
    } catch (err) {
      ui.notifications.error(err.message);
    } finally {
      this.#picked.clear();
      this.#busy = false;
      this.render();
    }
  }

  static async #onOpenSubject(_event, target) {
    const doc = await fromUuid(target.dataset.uuid).catch(() => null);
    if (!doc?.sheet) return ui.notifications.warn(loc("repair.subjectGone"));
    doc.sheet.render(true);
  }
}

/** The settings-menu entry: Foundry builds its own instance, which hands off to the open one. */
export class RepairMenu extends RepairApp {
  async render(...args) {
    if (instance && instance !== this && instance.rendered) {
      instance.bringToFront();
      return this;
    }
    instance = this;
    return super.render(...args);
  }
}

/**
 * Open the repair window, showing every check or only those in `only`. GM only;
 * a second call raises the open window instead of making another.
 * @returns {RepairApp|null}
 */
export function openRepairTool({ only = null } = {}) {
  if (!game.user?.isGM) {
    ui.notifications.warn(loc("repair.gmOnly"));
    return null;
  }
  if (instance?.rendered) {
    instance.showOnly(only);
    instance.bringToFront();
    return instance;
  }
  instance = new RepairApp({ only });
  instance.render(true);
  return instance;
}
