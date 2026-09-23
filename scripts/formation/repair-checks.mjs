/* global game, fromUuid */
/**
 * Formation's repair checks: marching-order members whose actor is gone, and
 * true-position markers (shadows) standing outside the episode they belong to.
 * A shadow the check cannot place on its own — an open episode's only marker on
 * another scene, or an open episode with none — is reported, never moved: the
 * lost panel is where an episode is re-anchored or ended.
 */
import { MODULE_ID } from "../lib/constants.mjs";
import { fixEach, registerRepairCheck } from "../lib/repair.mjs";
import { getPartyActor, patchFormation, readFormations } from "./formation-model.mjs";
import { SHADOW_FLAG, shadowsOn } from "./shadow.mjs";
import { lostOf } from "./lost.mjs";
import { travelOf } from "./travel.mjs";
import { episodeScene } from "./lost-episode.mjs";
import { PartySheet } from "./party-actor.mjs";

const loc = (key, data = {}) => game.i18n.format(`ACKS-FORMATION.repair.check.${key}`, data);

/** A cell whose actor the world no longer holds. Blank squares are never dead. */
const deadMember = (m) => !!m && !m.blank && !!m.actorId && !game.actors.get(m.actorId);

/**
 * A shadow as a finding. `reason` names the lang key of the other way to settle
 * it: a marker from a closed episode is where that party last really stood, so
 * the finding points at the panel that can move the party onto it.
 */
function shadowFinding(token, formation, why, { fixable = true, reason = null } = {}) {
  return {
    key: token.uuid,
    uuid: token.uuid,
    name: formation?.name ?? token.name,
    detail: loc(`shadows.${why}`, { scene: token.parent?.name ?? "?" }),
    fixable,
    reason: reason ? loc(`shadows.${reason}`) : null,
  };
}

/** Registers formation's checks. Called once, at `init`. */
export function registerFormationRepairChecks() {
  registerRepairCheck({
    id: "formation.members",
    label: "ACKS-FORMATION.repair.check.members.label",
    hint: "ACKS-FORMATION.repair.check.members.hint",
    order: 10,
    scan: () =>
      Object.values(readFormations())
        .map((f) => [f, (f?.members ?? []).filter(deadMember)])
        .filter(([, dead]) => dead.length)
        .map(([f, dead]) => ({
          key: f.id,
          uuid: getPartyActor(f)?.uuid ?? null,
          name: f.name,
          formationId: f.id,
          detail: loc("members.detail", { count: dead.length }),
        })),
    fix: async (findings) => {
      const results = await fixEach(findings, (f) =>
        patchFormation(f.formationId, (rec) => {
          const dead = new Set((rec.members ?? []).filter(deadMember).map((m) => m.actorId));
          if (!dead.size) return false;
          rec.members = rec.members.filter((m) => !deadMember(m));
          rec.lights = (rec.lights ?? []).filter((l) => !dead.has(l.bearerId));
          rec.spells = (rec.spells ?? []).filter((s) => !dead.has(s.casterId));
        })
      );
      PartySheet.refreshAll();
      return results;
    },
  });

  registerRepairCheck({
    id: "formation.shadows",
    label: "ACKS-FORMATION.repair.check.shadows.label",
    hint: "ACKS-FORMATION.repair.check.shadows.hint",
    order: 20,
    scan: () => {
      const formations = readFormations();
      const byFormation = new Map();
      for (const scene of game.scenes) {
        for (const token of shadowsOn(scene)) {
          const id = token.getFlag(MODULE_ID, SHADOW_FLAG);
          byFormation.set(id, [...(byFormation.get(id) ?? []), token]);
        }
      }
      const out = [];
      for (const [id, tokens] of byFormation) {
        const formation = formations[id] ?? null;
        if (!formation) {
          out.push(...tokens.map((t) => shadowFinding(t, null, "orphan")));
          continue;
        }
        const lost = lostOf(travelOf(formation));
        if (!lost.phase) {
          out.push(...tokens.map((t) => shadowFinding(t, formation, "closed", { reason: "orMove" })));
          continue;
        }
        // The episode keeps the newest marker on its own scene; every other one is spare.
        const home = episodeScene(formation, lost);
        const kept = tokens.filter((t) => t.parent === home).at(-1) ?? null;
        for (const t of tokens) {
          if (t === kept) continue;
          if (kept) out.push(shadowFinding(t, formation, "duplicate"));
          else out.push(shadowFinding(t, formation, "misplaced", { fixable: false, reason: "viaPanel" }));
        }
      }
      for (const formation of Object.values(formations)) {
        if (!lostOf(travelOf(formation)).phase || byFormation.has(formation.id)) continue;
        out.push({
          key: `missing:${formation.id}`,
          uuid: getPartyActor(formation)?.uuid ?? null,
          name: formation.name,
          detail: loc("shadows.missing"),
          fixable: false,
          reason: loc("shadows.viaPanel"),
        });
      }
      return out;
    },
    fix: (findings) =>
      fixEach(findings, async (f) => {
        const token = await fromUuid(f.uuid);
        if (token) await token.delete();
      }),
  });
}
