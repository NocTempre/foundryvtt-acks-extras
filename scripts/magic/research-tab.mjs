/* global game, foundry, fromUuid, fromUuidSync, ui */
/**
 * The Research tab of the location sheet: the facility values, the open projects
 * with their researchers, credited research and costs, and each project's
 * components bucket, with the day each posted and credited as a strip, the posted days beneath it
 * with an X to withdraw each, a pace to work a day at and the button that posts it (a Judge's opens
 * a prompt for a range of days). The sheet hosts it (`prepareResearchTab` fills its context,
 * `bindResearchTab` wires its controls, `RESEARCH_TAB_ACTIONS` are spread into its
 * `actions`); every write goes through `acksExtras.magic.research`
 * (`research-project-live.mjs`), which writes where the seat may and otherwise
 * asks the GM's client.
 *
 * A control writes by its own listener and stops the event there, so the sheet's
 * submit-on-change never sees it: no control writes through the form, and the facility
 * inputs exist only on a Judge's render. The pace radios write nothing: the choice is held
 * per window (`paceMemory`) and read by the Post control. Finish throws the project's research and writes
 * its result through the API; the result is a chat card, so the tab draws nothing for it.
 */
import { MODULE_ID } from "./constants.mjs";
import { researchApi, linkedCharacters, recordOf, liveDeps, levelOf, intBonusOf, loc, announce, projectEntries, formulasOf, cookbookOf, subjectTypeOf, partXpOf } from "./research-project-live.mjs";
import { PROJECT_KINDS, FACILITY_KEYS, PACE, PACES, RANGE_MAX, POWER_PILLS, panelModel, componentPolicy, withPowerRow } from "./research-project.mjs";
import { elementOf } from "../lib/util.mjs";
import { BUCKET_ACTIONS, BUCKET_LANG_PREFIX, BUCKET_TEMPLATE, BUCKET_ROW_TEMPLATE, entriesFromAnswer, entryFromDrop, nextFit } from "../lib/bucket.mjs";

/** The partials the tab draws, loaded at `init` with the module's templates. */
export const RESEARCH_TAB_TEMPLATE = `modules/${MODULE_ID}/templates/magic/research-tab.hbs`;
export const RESEARCH_TEMPLATES = Object.freeze([RESEARCH_TAB_TEMPLATE, BUCKET_TEMPLATE, BUCKET_ROW_TEMPLATE]);

/** The windows a prompt of this tab opens name the module's scroll contract. */
const DIALOG_CLASSES = ["acks-ui", "acks-extras", "acks-extras-scroll"];

const bucketLoc = (key, data) => game.i18n.format(`${BUCKET_LANG_PREFIX}.${key}`, data ?? {});

/** A document of a uuid that resolves, else null. */
const resolveDoc = (uuid) => fromUuid(uuid).catch(() => null);

/** Each window's pace choice per project, held by the window and never written to the record. */
const paceMemory = new WeakMap();

/** Each window's Add power row per project (open, the power it stands on and the amount typed), held by the window and never written to the record. */
const powerMemory = new WeakMap();

/** This window's Add power row for a project; closed, on the first power and blank until the viewer opens or edits it. */
export function powerRowOf(sheet, projectId) {
  if (!powerMemory.has(sheet)) powerMemory.set(sheet, new Map());
  const held = powerMemory.get(sheet);
  if (!held.has(projectId)) held.set(projectId, { open: false, kind: POWER_PILLS[0], amount: "" });
  return held.get(projectId);
}

/** The pace a window has chosen for a project's day: dedicated until one is picked. */
export function paceOf(sheet, projectId) {
  return paceMemory.get(sheet)?.get(projectId) ?? PACE.dedicated;
}

/**
 * Fill the sheet's context for the tab: `context.research` is the panel and
 * `context.researchOpen` the count of open projects. A world without the
 * magic API (the feature off) leaves both unset, and the sheet drops the tab.
 */
export async function prepareResearchTab(sheet, context) {
  const location = sheet.actor;
  const record = recordOf(location);
  const entries = {};
  for (const project of record.projects.filter((p) => p.status === "open")) entries[project.id] = await projectEntries(project);
  const deps = liveDeps();
  const { powerApi } = await import("./power-ledger-live.mjs");
  context.research = panelModel({
    record,
    tables: deps.tables(),
    linked: linkedCharacters(location),
    today: deps.today(),
    loc,
    bucketLoc,
    judge: game.user.isGM === true,
    owns: deps.owns,
    entries,
    levelOf,
    intBonusOf,
    paceOf: (id) => paceOf(sheet, id),
    formulasOf,
    cookbookOf,
    subjectTypeOf,
    powerOf: (uuid, kind) => powerApi.balance(fromUuidSync(uuid), kind),
    addPowerOf: (id) => powerRowOf(sheet, id),
  });
  context.researchOpen = context.research.openCount;
}

/** The id of the project a control sits in. */
const projectIdOf = (target) => target?.closest?.("[data-project-id]")?.dataset?.projectId ?? "";

/** A value typed in a number box: null for blank, else the number as typed (the model cleans it). */
const numberOf = (value) => (String(value).trim() === "" ? null : Number(value));

/** `{costs: {material: 3}}` from a path `costs.material` and its value. */
const patchOf = (path, value) => path.split(".").reduceRight((inner, key) => ({ [key]: inner }), value);

/** The prompt that starts a project: a kind, a subject name, a level and the researcher. Null when dismissed. */
async function promptProject(location) {
  const linked = linkedCharacters(location).filter((a) => game.user.isGM || liveDeps().owns(a.uuid));
  const esc = foundry.utils.escapeHTML;
  const options = (rows) => rows.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join("");
  const content = `
    <label>${esc(loc("promptKind"))} <select name="kind">${options(PROJECT_KINDS.map((k) => [k, loc(`kind.${k}`)]))}</select></label>
    <label>${esc(loc("promptSubject"))} <input type="text" name="subject"></label>
    <label>${esc(loc("levelLabel"))} <input type="number" name="level" min="1" step="1"></label>
    <label>${esc(loc("promptResearcher"))} <select name="researcher">${options(linked.map((a) => [a.uuid, a.name]))}</select></label>`;
  return foundry.applications.api.DialogV2.prompt({
    classes: DIALOG_CLASSES,
    window: { title: loc("newProject") },
    content,
    ok: {
      label: loc("start"),
      callback: (_event, button) => {
        const form = button.form.elements;
        return { kind: form.kind.value, subject: { name: form.subject.value.trim() }, level: numberOf(form.level.value), researcher: form.researcher.value };
      },
    },
  }).catch(() => null);
}

/** Press of "New project": ask for the project, then start it. */
async function onNewProject() {
  const spec = await promptProject(this.actor);
  if (!spec) return;
  announce(await researchApi.create(this.actor, spec));
  this.render();
}

/**
 * The prompt behind a Judge's Post days…: how many days, from which day (today unless changed)
 * and at what pace (this window's choice to start). Null when dismissed.
 * @returns {Promise<{days: number|null, from: number|null, pace: string}|null>}
 */
async function promptDays(project, today, pace) {
  const esc = foundry.utils.escapeHTML;
  const pills = PACES.map((value) => `<button type="button" class="acks-extras-research-prompt__pill" data-pace="${esc(value)}" aria-pressed="${value === pace}">${esc(loc(`paceName.${value}`))}</button>`).join("");
  const content = `<div class="acks-extras-research-prompt">
    <label class="acks-extras-research-prompt__row"><span>${esc(loc("promptDays"))}</span> <input type="number" class="acks-input acks-input--num" name="days" min="1" max="${RANGE_MAX}" step="1" value="1"></label>
    <label class="acks-extras-research-prompt__row"><span>${esc(loc("promptFrom"))}</span> <input type="number" class="acks-input acks-input--num" name="from" step="1" value="${esc(String(today))}"></label>
    <div class="acks-extras-research-prompt__row" role="group" aria-label="${esc(loc("promptPace"))}"><span>${esc(loc("promptPace"))}</span><span class="acks-extras-research-prompt__pills">${pills}</span></div>
    <span class="acks-extras-research__cap" data-range-caption></span>
  </div>`;
  return foundry.applications.api.DialogV2.prompt({
    classes: DIALOG_CLASSES,
    window: { title: loc("promptDaysTitle", { name: project.subject.name || loc(`kind.${project.kind}`) }), icon: "fa-solid fa-calendar-days" },
    position: { width: 380 },
    content,
    render: (_event, dialog) => {
      const root = elementOf(dialog?.element);
      const form = root?.querySelector?.("form") ?? root;
      if (!form?.querySelector) return;
      const days = form.querySelector('input[name="days"]');
      const from = form.querySelector('input[name="from"]');
      const caption = form.querySelector("[data-range-caption]");
      const say = () => {
        const n = Math.trunc(Number(days.value));
        const first = Math.trunc(Number(from.value));
        caption.textContent = Number.isFinite(n) && n >= 1 && Number.isFinite(first) ? loc("promptCaption", { from: first, to: first + n - 1 }) : "";
      };
      for (const box of [days, from]) box.addEventListener("input", say);
      for (const pill of form.querySelectorAll("[data-pace]")) {
        pill.addEventListener("click", () => {
          for (const other of form.querySelectorAll("[data-pace]")) other.setAttribute("aria-pressed", String(other === pill));
        });
      }
      say();
    },
    ok: {
      label: loc("promptPost"),
      callback: (_event, button) => {
        const form = button.form;
        const pace = form.querySelector('[data-pace][aria-pressed="true"]')?.dataset?.pace;
        return { days: numberOf(form.elements.days.value), from: numberOf(form.elements.from.value), pace: PACES.includes(pace) ? pace : PACE.dedicated };
      },
    },
  }).catch(() => null);
}

/** Press of a Judge's Post days…: ask for the range, then post it. */
async function onPostDays(_event, target) {
  const id = projectIdOf(target);
  const project = recordOf(this.actor).projects.find((p) => p.id === id);
  if (!project) return;
  const picks = await promptDays(project, liveDeps().today(), paceOf(this, id));
  if (!picks) return;
  announce(await researchApi.postRange(this.actor, id, picks));
  this.render();
}

/** Press of the X on a posted day: it is taken back, where the viewer may. */
async function onWithdrawDay(_event, target) {
  const id = projectIdOf(target);
  if (id) announce(await researchApi.withdraw(this.actor, id, Number(target.dataset.day)));
  this.render();
}

/** Press of Post: the day, at the pace this window chose, is posted. */
async function onPostDay(_event, target) {
  const id = projectIdOf(target);
  if (id) announce(await researchApi.post(this.actor, id, { pace: paceOf(this, id) }));
  this.render();
}

/** Press of a project's close control. */
async function onCloseProject(_event, target) {
  const id = projectIdOf(target);
  if (id) announce(await researchApi.close(this.actor, id));
  this.render();
}

/** Press of Finish: the project throws and writes its result, where the viewer may; the result is told on the card. */
async function onFinishProject(_event, target) {
  const id = projectIdOf(target);
  if (id) announce(await researchApi.finish(this.actor, id));
  this.render();
}

/** The fit chip of a component row: the next fit the project's policy offers, written to the stored row. */
async function onBucketFit(_event, target) {
  const id = target.closest("[data-bucket]")?.dataset?.bucket ?? "";
  const project = recordOf(this.actor).projects.find((p) => p.id === id);
  if (!project) return;
  const entry = (await projectEntries(project)).find((e) => e.uuid === target.dataset.uuid);
  if (!entry) return;
  const fit = nextFit(entry, componentPolicy(project).fit);
  const bucket = project.bucket.some((row) => row.uuid === entry.uuid) ? project.bucket.map((row) => (row.uuid === entry.uuid ? { ...row, fit } : row)) : project.bucket;
  announce(await researchApi.update(this.actor, id, { bucket }));
  this.render();
}

/** Press of Add power: the row opens or closes in this window. */
function onTogglePower(_event, target) {
  const id = projectIdOf(target);
  if (!id) return;
  const row = powerRowOf(this, id);
  row.open = !row.open;
  this.render();
}

/** Press of a power pill: the row stands on that power in this window. */
function onPickPower(_event, target) {
  const id = projectIdOf(target);
  if (!id || !POWER_PILLS.includes(target.dataset.kind)) return;
  powerRowOf(this, id).kind = target.dataset.kind;
  this.render();
}

/**
 * Press of Add: the typed amount joins the power row of that power in the project's bucket, held to what the researcher's
 * ledger holds, through the project's own update (a Player's is refused for a researcher they do not own, as every project write).
 */
async function onAddPower(_event, target) {
  const id = projectIdOf(target);
  const project = recordOf(this.actor).projects.find((p) => p.id === id);
  if (!project) return;
  const row = powerRowOf(this, id);
  const box = target.closest("[data-project-id]")?.querySelector("[data-research-power-amount]");
  const { powerApi } = await import("./power-ledger-live.mjs");
  const bucket = withPowerRow(project.bucket, row.kind, box ? box.value : row.amount, powerApi.balance(fromUuidSync(project.researcher), row.kind));
  if (!bucket) {
    ui.notifications?.warn(loc("refused.power"));
    return;
  }
  announce(await researchApi.update(this.actor, id, { bucket }));
  row.amount = "";
  this.render();
}

/** Press of an assistant's remove control. */
async function onRemoveAssistant(_event, target) {
  const id = projectIdOf(target);
  const project = recordOf(this.actor).projects.find((p) => p.id === id);
  if (!project) return;
  announce(await researchApi.update(this.actor, id, { assistants: project.assistants.filter((u) => u !== target.dataset.uuid) }));
  this.render();
}

/** X on a bucket row: the entry leaves that project's bucket. */
async function onBucketRemove(_event, target) {
  const id = target.closest("[data-bucket]")?.dataset?.bucket ?? "";
  const project = recordOf(this.actor).projects.find((p) => p.id === id);
  if (!project) return;
  announce(await researchApi.update(this.actor, id, { bucket: project.bucket.filter((row) => row.uuid !== target.dataset.uuid) }));
  this.render();
}

/** The actions the location sheet spreads into its own. */
export const RESEARCH_TAB_ACTIONS = {
  newResearchProject: onNewProject,
  postResearchDay: onPostDay,
  postResearchDays: onPostDays,
  withdrawResearchDay: onWithdrawDay,
  closeResearchProject: onCloseProject,
  finishResearchProject: onFinishProject,
  removeResearchAssistant: onRemoveAssistant,
  toggleResearchPower: onTogglePower,
  pickResearchPower: onPickPower,
  addResearchPower: onAddPower,
  [BUCKET_ACTIONS.remove]: onBucketRemove,
  [BUCKET_ACTIONS.fit]: onBucketFit,
};

/** The data a drag event carries, read through core's editor. */
const dragData = (event) => foundry.applications.ux.TextEditor.implementation.getDragEventData(event);

/** Make a zone take a drop: it is the tab's own, so the sheet's drop on the location never sees it. */
function takesDrops(zone, onDrop) {
  zone.addEventListener("dragover", (event) => event.preventDefault());
  zone.addEventListener("drop", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await onDrop(dragData(event));
  });
}

/**
 * Wire the tab's controls after a render. A node is told by `nodeType` and a
 * control by `matches`, since the window may have been first rendered in a
 * browser window of its own.
 */
export function bindResearchTab(sheet) {
  const root = sheet.element;
  if (!root?.querySelectorAll) return;
  const location = sheet.actor;

  const write = async (promise) => {
    const result = await promise;
    announce(result);
    if (result?.ok === false) sheet.render();
  };

  // Control changes write by the API and stop the change here, so the sheet's form never submits it.
  for (const box of root.querySelectorAll("[data-research-facility]")) {
    box.addEventListener("change", (event) => {
      event.stopPropagation();
      if (FACILITY_KEYS.includes(box.dataset.researchFacility)) write(researchApi.setFacility(location, box.dataset.researchFacility, numberOf(box.value)));
    });
  }
  for (const box of root.querySelectorAll("[data-research-field]")) {
    box.addEventListener("change", (event) => {
      event.stopPropagation();
      const id = projectIdOf(box);
      if (!id) return;
      const path = box.dataset.researchField;
      const value = box.type === "number" ? numberOf(box.value) : box.value.trim();
      write(researchApi.update(location, id, patchOf(path, value)));
    });
  }
  for (const box of root.querySelectorAll("[data-research-power-amount]")) {
    box.addEventListener("change", (event) => {
      event.stopPropagation();
      const id = projectIdOf(box);
      if (id) powerRowOf(sheet, id).amount = box.value;
    });
  }
  for (const radio of root.querySelectorAll("[data-research-pace]")) {
    radio.addEventListener("change", (event) => {
      event.stopPropagation();
      const id = projectIdOf(radio);
      if (!id || !radio.checked || !PACES.includes(radio.value)) return;
      if (!paceMemory.has(sheet)) paceMemory.set(sheet, new Map());
      paceMemory.get(sheet).set(id, radio.value);
    });
  }
  for (const pick of root.querySelectorAll("[data-research-add-assistant]")) {
    pick.addEventListener("change", (event) => {
      event.stopPropagation();
      const id = projectIdOf(pick);
      const project = recordOf(location).projects.find((p) => p.id === id);
      if (!project || !pick.value) return;
      write(researchApi.update(location, id, { assistants: [...project.assistants, pick.value] }));
    });
  }

  for (const zone of root.querySelectorAll("[data-bucket-drop]")) {
    takesDrops(zone, async (data) => {
      const id = zone.dataset.bucketDrop;
      const project = recordOf(location).projects.find((p) => p.id === id);
      if (!project) return;
      const held = (await entriesFromAnswer(project.bucket, resolveDoc)).entries;
      const made = await entryFromDrop(data, resolveDoc, { policy: componentPolicy(project, { partXp: partXpOf }), present: held });
      if (made.refused) {
        ui.notifications?.warn(loc(`refused.drop.${made.refused}`, { name: made.name ?? "" }));
        return;
      }
      await write(researchApi.update(location, id, { bucket: [...project.bucket, { uuid: made.entry.uuid, qty: made.entry.qty, fit: made.entry.fit }] }));
    });
  }
  for (const zone of root.querySelectorAll("[data-research-subject-drop]")) {
    takesDrops(zone, async (data) => {
      const id = projectIdOf(zone);
      const doc = data?.type === "Item" && data.uuid ? await resolveDoc(data.uuid) : null;
      if (!id || !doc) {
        ui.notifications?.warn(loc("refused.drop.subject"));
        return;
      }
      await write(researchApi.update(location, id, { subject: { uuid: doc.uuid, name: doc.name, img: doc.img ?? "" } }));
    });
  }
}
