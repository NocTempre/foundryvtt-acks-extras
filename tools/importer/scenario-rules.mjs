/**
 * Register rules for a book's numbered scenarios and for roster links, over
 * every row at once (`rows`: id -> row). Pure: no file system, so a suite
 * holds each rule to invented rows. `lint-register.mjs` runs them.
 */

/** A scenario's key space `<book>.scenario<N>`, or a row under it (`-<key>`). Its plan, `<book>.scenario<N>Map`, is no match. */
const SCENARIO_ID = /^([a-z][a-z0-9]{1,3}\.scenario(\d+))(-[A-Za-z0-9]+)?$/;

/** The kinds a roster link may name: a creature or a person the library holds as an actor. A row with no kind is a monster. */
const ROSTER_KINDS = new Set(["kind.monster", "kind.npc"]);

/**
 * Numbered scenarios. A row `<book>.scenario<N>` is a key space: a location
 * row in no space itself, which some area names in `meta.space` and exactly
 * one scene row stands up as its plan (`scene.place`, with no `scene.part`).
 * A scene row that is one of several maps of the place (`scene.part`) stands
 * beside the plan, and its pins count with the plan's. Every row under it
 * (`<book>.scenario<N>-<key>`) that is a location sits in that space. The
 * space and every row under it carry `meta.group: "Scenario <N>"`, the folder
 * the scenario's places and people file in.
 *
 * The plan pins the space's own areas and nothing else, and every area is on
 * it: pinned itself, or reached through `meta.parent` from an area that is
 * (a lettered part of a room the plan numbers once).
 *
 * @param {Map<string, object>} rows
 * @returns {string[]} one line per problem
 */
export function scenarioProblems(rows) {
  const out = [];
  const plans = new Map(); // space id -> scene rows naming it
  for (const r of rows.values()) {
    if (r.kind !== "kind.scene" || typeof r.scene?.place !== "string") continue;
    if (!plans.has(r.scene.place)) plans.set(r.scene.place, []);
    plans.get(r.scene.place).push(r);
  }
  const areasOf = new Map(); // space id -> rows in it
  for (const r of rows.values()) {
    if (r.meta?.space === undefined) continue;
    if (!areasOf.has(r.meta.space)) areasOf.set(r.meta.space, []);
    areasOf.get(r.meta.space).push(r);
  }

  for (const r of rows.values()) {
    const m = SCENARIO_ID.exec(r.id ?? "");
    if (!m) continue;
    const [, space, n, key] = m;
    const group = `Scenario ${n}`;
    if (r.meta?.group !== group) out.push(`${r.id}: a scenario row carries meta.group "${group}", the folder its scenario files in`);
    if (key) {
      if (r.kind === "kind.location" && r.meta?.space !== space) out.push(`${r.id}: an area of a scenario sits in its key space (meta.space "${space}")`);
      continue;
    }
    if (r.kind !== "kind.location") out.push(`${r.id}: a scenario is a location row, the key space its areas sit in`);
    else if (r.meta?.space !== undefined) out.push(`${r.id}: a scenario is a key space and sits in none`);
    const areas = areasOf.get(r.id) ?? [];
    if (!areas.length) out.push(`${r.id}: a scenario is a key space, and no area names it in meta.space`);
    const mine = plans.get(r.id) ?? [];
    const whole = mine.filter((s) => s.scene.part === undefined);
    if (whole.length !== 1) {
      out.push(`${r.id}: a scenario has one plan, a scene row whose scene.place names it and that is no part of it (found ${whole.length})`);
      continue;
    }
    const plan = whole[0];
    const pinned = new Set();
    for (const scene of mine) {
      for (const p of scene.scene.places ?? []) {
        if (typeof p?.id !== "string") continue;
        if (rows.get(p.id)?.meta?.space !== r.id) out.push(`${scene.id}: pins ${p.id}, which is no area of ${r.id}`);
        else pinned.add(p.id);
      }
    }
    for (const area of areas) {
      const seen = new Set();
      let at = area;
      while (at && !pinned.has(at.id) && !seen.has(at.id)) {
        seen.add(at.id);
        at = at.meta?.parent !== undefined && at.meta.parent !== r.id ? rows.get(at.meta.parent) : undefined;
      }
      if (!at || !pinned.has(at.id)) out.push(`${area.id}: is not on its plan ${plan.id}: neither it nor an area it is part of (meta.parent) is pinned`);
    }
  }
  return out;
}

/**
 * Roster links. `meta.roster` belongs on a keyed place (a key space, or an
 * area of one) and is a list of cookbook ids, each named once, each a row
 * that imports as a creature or a person (`ROSTER_KINDS`).
 *
 * @param {Map<string, object>} rows
 * @returns {string[]} one line per problem
 */
export function rosterProblems(rows) {
  const out = [];
  const spaces = new Set();
  for (const r of rows.values()) if (r.meta?.space !== undefined) spaces.add(r.meta.space);
  for (const r of rows.values()) {
    const roster = r.meta?.roster;
    if (roster === undefined) continue;
    if (r.kind !== "kind.location" || (r.meta.space === undefined && !spaces.has(r.id))) {
      out.push(`${r.id}: meta.roster belongs on a keyed place, a key space or an area of one`);
      continue;
    }
    if (!Array.isArray(roster) || !roster.length || roster.some((id) => typeof id !== "string")) {
      out.push(`${r.id}: meta.roster is a list of cookbook ids, at least one`);
      continue;
    }
    const seen = new Set();
    for (const id of roster) {
      const target = rows.get(id);
      if (seen.has(id)) out.push(`${r.id}: meta.roster names ${id} twice`);
      else if (!target) out.push(`${r.id}: meta.roster names "${id}", which no row defines`);
      else if (target.kind !== undefined && !ROSTER_KINDS.has(target.kind)) out.push(`${r.id}: meta.roster names ${id}, which is not a creature or a person (${target.kind})`);
      seen.add(id);
    }
  }
  return out;
}
