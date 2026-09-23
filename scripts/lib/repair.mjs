/* global game, foundry, fromUuidSync */
/**
 * The repair tool's Foundry half: the walk every check shares, the runner a GM
 * drives, and the report whispered to the GMs after a fix. Registration and the
 * scan → fix → rescan rule are `repair-logic.mjs`; the window is
 * `apps/repair-app.mjs`.
 */
import { LANG_PREFIX } from "./constants.mjs";
import { makeLoc } from "./util.mjs";
import { postToJudges } from "./roll-audience.mjs";
import { FAILURE, fixCheck, getRepairCheck, repairChecks, scanCheck } from "./repair-logic.mjs";

export { FAILURE, danglingRefCheck, fixEach, getRepairCheck, registerRepairCheck, repairChecks } from "./repair-logic.mjs";

const loc = makeLoc(LANG_PREFIX);
const esc = (text) => foundry.utils.escapeHTML(String(text ?? ""));

/** Every actor a check walks: the world's own, then each unlinked token's. */
export function worldActors() {
  const out = [...(game.actors ?? [])];
  for (const scene of game.scenes ?? []) {
    for (const token of scene.tokens ?? []) {
      if (!token.actorLink && token.actor) out.push(token.actor);
    }
  }
  return out;
}

/** Throws for a non-GM: every check reads the whole world and every fix writes it. */
function requireGM() {
  if (!game.user?.isGM) throw new Error(loc("repair.gmOnly"));
}

/**
 * Scan every check, or those named in `only`. GM only.
 * @returns {Promise<{id: string, findings: object[], error: string|null}[]>}
 */
export async function scanRepairs({ only = null } = {}) {
  requireGM();
  const out = [];
  for (const check of repairChecks({ only })) out.push(await scanCheck(check));
  return out;
}

/**
 * Fix the findings of one check named by `keys`, taken from a fresh scan, then
 * rescan it and whisper the outcome to the GMs. A key the fresh scan no longer
 * reports is returned in `gone` and left alone. GM only.
 * @returns {Promise<{id: string, fixed: object[], failed: object[], gone: string[], rescan: object}>}
 */
export async function fixRepairs(id, keys, { report = true } = {}) {
  requireGM();
  const check = getRepairCheck(id);
  if (!check?.fix) throw new Error(`repair: "${id}" is not a fixable check`);
  const wanted = new Set([...(keys ?? [])].map(String));
  const fresh = await scanCheck(check);
  if (fresh.error) return { id, fixed: [], failed: [], gone: [], rescan: fresh };
  const found = new Set(fresh.findings.map((f) => f.key));
  const gone = [...wanted].filter((k) => !found.has(k));
  const chosen = fresh.findings.filter((f) => f.fixable && wanted.has(f.key));
  const outcome = { ...(await fixCheck(check, chosen)), gone };
  if (report && (outcome.fixed.length || outcome.failed.length)) await postRepairReport([outcome]);
  return outcome;
}

/** A failure's reason, as the report and the window print it. */
export function failureText(entry) {
  const why = Object.values(FAILURE).includes(entry?.why) ? entry.why : FAILURE.still;
  const base = loc(`repair.failure.${why}`);
  return entry?.error ? `${base} ${entry.error}` : base;
}

/** A subject as a link while it exists, as its name once it does not. */
function subject(finding) {
  let live = null;
  try {
    live = finding.uuid ? fromUuidSync(finding.uuid) : null;
  } catch {
    live = null;
  }
  return live ? `@UUID[${finding.uuid}]{${esc(finding.name)}}` : esc(finding.name);
}

/**
 * Whisper fix outcomes to the GMs: per check, each finding fixed and each that
 * failed with its reason, linked to its subject.
 */
export async function postRepairReport(outcomes) {
  const sections = [];
  for (const o of outcomes) {
    const check = getRepairCheck(o.id);
    const lines = [
      ...o.fixed.map((f) => `<li>${subject(f)}: ${esc(f.summary || f.detail)}</li>`),
      ...o.failed.map((f) => `<li class="acks-extras-repair-failed">${subject(f)}: ${esc(failureText(f))}</li>`),
    ];
    sections.push(
      `<h4>${esc(check ? game.i18n.localize(check.label) : o.id)}</h4>` +
        `<p>${esc(loc("repair.report.counts", { fixed: o.fixed.length, failed: o.failed.length }))}</p>` +
        `<ul>${lines.join("")}</ul>`
    );
  }
  if (!sections.length) return null;
  return postToJudges({ content: `<div class="acks-extras-repair-report"><h3>${esc(loc("repair.report.title"))}</h3>${sections.join("")}</div>` });
}
