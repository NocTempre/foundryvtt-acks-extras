/**
 * The repair registry and its runner, Foundry-free. A feature registers each
 * kind of damaged data it knows how to find; the runner scans a check, fixes
 * the findings the Judge chose, and rescans it, so a fix is judged by what the
 * world holds afterwards rather than by what the fix reported. `repair.mjs` is
 * the Foundry half: the world walks, the report, the entry points.
 */

const _checks = new Map();

/** Why a chosen finding was not fixed. */
export const FAILURE = Object.freeze({
  /** The fix reported success and the rescan still finds it. */
  still: "still",
  /** The fix reported that it could not. */
  refused: "refused",
  /** The fix threw before reporting anything. */
  threw: "threw",
  /** The rescan threw, so nothing can be confirmed. */
  unverified: "unverified",
});

const message = (err) => String(err?.message ?? err ?? "");

/**
 * Register one check. Ids are unique; a second registration of an id throws.
 * A check with no `fix` is report-only: its findings are listed, never offered.
 *
 * @param {object} spec
 * @param {string} spec.id `<feature>.<name>`
 * @param {string} spec.label i18n key naming what the check looks for
 * @param {string} [spec.hint] i18n key saying what its fix does
 * @param {() => Promise<object[]>} spec.scan read-only; resolves to findings
 *   `{key, uuid, name, detail, fixable?, reason?}`, `key` unique within the check
 * @param {(findings: object[]) => Promise<object[]>} [spec.fix] resolves to
 *   `{key, ok, summary?, error?}` per finding it was handed
 * @param {number} [spec.order] sort position inside its feature
 * @param {() => boolean} [spec.requires] false hides the check
 * @returns {object} the registered check
 */
export function registerRepairCheck({ id, label, hint = "", scan, fix = null, order = 0, requires = () => true } = {}) {
  if (typeof id !== "string" || !/^[\w-]+\.[\w-]+$/.test(id)) throw new Error(`repair: check id "${id}" is not <feature>.<name>`);
  if (_checks.has(id)) throw new Error(`repair: check "${id}" is already registered`);
  if (typeof scan !== "function") throw new Error(`repair: check "${id}" has no scan`);
  const check = Object.freeze({
    id,
    feature: id.split(".")[0],
    label: String(label ?? id),
    hint: String(hint ?? ""),
    scan,
    fix: typeof fix === "function" ? fix : null,
    order: Number.isFinite(order) ? order : 0,
    requires: typeof requires === "function" ? requires : () => true,
  });
  _checks.set(id, check);
  return check;
}

/** The check registered under `id`, or null. */
export const getRepairCheck = (id) => _checks.get(id) ?? null;

/**
 * Every check whose `requires` holds, by feature, then order, then id.
 * `only` limits the list to those ids.
 */
export function repairChecks({ only = null } = {}) {
  const wanted = only ? new Set(only) : null;
  return [..._checks.values()]
    .filter((c) => !wanted || wanted.has(c.id))
    .filter((c) => {
      try {
        return c.requires() !== false;
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.feature.localeCompare(b.feature) || a.order - b.order || a.id.localeCompare(b.id));
}

/** Drop every registration (tests). */
export function resetRepairChecks() {
  _checks.clear();
}

/**
 * Scan one check. A scan that throws reports its error with no findings, so one
 * broken check never takes the others down. Keys are strings and unique; a
 * finding of a report-only check is never fixable.
 * @returns {Promise<{id: string, findings: object[], error: string|null}>}
 */
export async function scanCheck(check) {
  let raw;
  try {
    raw = await check.scan();
  } catch (err) {
    return { id: check.id, findings: [], error: message(err) || "error" };
  }
  const seen = new Set();
  const findings = [];
  for (const f of Array.isArray(raw) ? raw : []) {
    if (f?.key == null) continue;
    const key = String(f.key);
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({
      ...f,
      key,
      uuid: f.uuid ?? null,
      name: String(f.name ?? ""),
      detail: String(f.detail ?? ""),
      fixable: !!check.fix && f.fixable !== false,
      reason: f.reason ? String(f.reason) : null,
    });
  }
  return { id: check.id, findings, error: null };
}

/**
 * Fix the chosen findings of one check, then rescan it. The rescan decides:
 * a finding it no longer reports is fixed, whatever the fix said, and one it
 * still reports has failed, whatever the fix said. Unfixable findings are
 * never handed to the fix.
 *
 * @returns {Promise<{id: string, fixed: object[], failed: object[], rescan: object}>}
 *   `failed` entries carry `why` (a FAILURE value) and `error`
 */
export async function fixCheck(check, findings) {
  if (!check.fix) throw new Error(`repair: check "${check.id}" is report-only`);
  const chosen = (findings ?? []).filter((f) => f?.fixable);
  let results = [];
  let threw = null;
  if (chosen.length) {
    try {
      results = (await check.fix(chosen)) ?? [];
    } catch (err) {
      threw = message(err) || "error";
    }
  }
  const byKey = new Map((Array.isArray(results) ? results : []).filter((r) => r?.key != null).map((r) => [String(r.key), r]));
  const rescan = await scanCheck(check);
  const still = new Set(rescan.findings.map((f) => f.key));
  const fixed = [];
  const failed = [];
  for (const f of chosen) {
    const r = byKey.get(f.key);
    if (rescan.error) failed.push({ ...f, why: FAILURE.unverified, error: rescan.error });
    else if (!still.has(f.key)) fixed.push({ ...f, summary: r?.summary ? String(r.summary) : null });
    else if (threw && !r) failed.push({ ...f, why: FAILURE.threw, error: threw });
    else if (r && r.ok === false) failed.push({ ...f, why: FAILURE.refused, error: r.error ? String(r.error) : null });
    else failed.push({ ...f, why: FAILURE.still, error: null });
  }
  return { id: check.id, fixed, failed, rescan };
}

/**
 * Run `fn` on each finding in turn, turning a throw into a refused result, so
 * one bad document leaves the rest of the batch to run.
 * @returns {Promise<{key: string, ok: boolean, summary?: string, error?: string}[]>}
 */
export async function fixEach(findings, fn) {
  const results = [];
  for (const f of findings) {
    try {
      const summary = await fn(f);
      results.push({ key: f.key, ok: true, summary: typeof summary === "string" ? summary : null });
    } catch (err) {
      results.push({ key: f.key, ok: false, error: message(err) || "error" });
    }
  }
  return results;
}

/**
 * A check for the commonest damage: a stored reference to a document that is
 * gone. `collect` lists every reference worth testing as a candidate finding,
 * `live` says whether one still resolves, and `clear` unlinks one that does
 * not.
 *
 * @param {object} spec the `registerRepairCheck` fields other than scan and fix
 * @param {() => Promise<object[]>|object[]} spec.collect candidate findings
 * @param {(candidate: object) => Promise<boolean>|boolean} spec.live
 * @param {(finding: object) => Promise<unknown>} spec.clear
 * @returns {object} a spec for `registerRepairCheck`
 */
export function danglingRefCheck({ collect, live, clear, ...spec }) {
  return {
    ...spec,
    scan: async () => {
      const out = [];
      for (const candidate of (await collect()) ?? []) {
        if (!(await live(candidate))) out.push(candidate);
      }
      return out;
    },
    fix: (findings) => fixEach(findings, clear),
  };
}
