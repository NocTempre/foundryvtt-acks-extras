/* global game, fromUuidSync */
/**
 * Location's repair checks: a place's map or region link that no longer holds,
 * banked coin a sweep has not moved, and storage whose owner is gone. The last
 * reports only: the storage manager is where goods change hands.
 */
import { MODULE_ID, LANG_PREFIX, LOCATION_TYPE, SCENE_LINK_FLAG } from "./constants.mjs";
import { makeLoc } from "../lib/util.mjs";
import { fixEach, registerRepairCheck } from "../lib/repair.mjs";
import { providers, resolveActorSync, storesByOwner, vaultOwnerUuid } from "../lib/storage.mjs";
import { locationOfRegion, locationOfScene, regionOfLocation, sceneOfLocation } from "./scene-link.mjs";
import { planVaultSweep, runVaultSweep } from "./vault-sweep.mjs";

const loc = makeLoc(LANG_PREFIX);
const key = (name) => `${LANG_PREFIX}.repair.check.${name}`;

/** The document a stored uuid names, or null. */
function resolve(uuid) {
  try {
    return uuid ? fromUuidSync(uuid) : null;
  } catch {
    return null;
  }
}

/** A place's mirror of a link, when the scene or region it names does not name it back. */
function staleMirror(place, field, reads, documentName) {
  const uuid = place.system?.[field];
  if (!uuid || reads(place)) return null;
  const target = resolve(uuid);
  const state = target?.documentName === documentName ? "disagrees" : "gone";
  return {
    key: `${field}:${place.uuid}`,
    uuid: place.uuid,
    name: place.name,
    field,
    detail: loc(`repair.check.links.${field}.${state}`, { name: target?.name ?? "" }),
  };
}

/** A scene's or region's link to a place that no longer exists. */
function staleFlag(doc, reads) {
  if (!doc.getFlag(MODULE_ID, SCENE_LINK_FLAG) || reads(doc)) return null;
  return {
    key: `flag:${doc.uuid}`,
    uuid: doc.uuid,
    name: doc.name,
    detail: loc(`repair.check.links.flag.${doc.documentName}`),
  };
}

/** Coin as a ledger lists it. */
const coinText = (ledger) => ledger.map((e) => `${e.quantity} ${e.name}`).join(", ");

/** Registers location's checks. Called once, at `init`. */
export function registerLocationRepairChecks() {
  registerRepairCheck({
    id: "location.links",
    label: key("links.label"),
    hint: key("links.hint"),
    order: 10,
    scan: () => {
      const out = [];
      for (const place of game.actors.filter((a) => a.type === LOCATION_TYPE)) {
        out.push(staleMirror(place, "sceneUuid", sceneOfLocation, "Scene"));
        out.push(staleMirror(place, "regionUuid", regionOfLocation, "Region"));
      }
      for (const scene of game.scenes) {
        out.push(staleFlag(scene, locationOfScene));
        for (const region of scene.regions ?? []) out.push(staleFlag(region, locationOfRegion));
      }
      return out.filter(Boolean);
    },
    fix: (findings) =>
      fixEach(findings, async (f) => {
        const doc = resolve(f.uuid);
        if (!doc) return;
        if (f.field) await doc.update({ [`system.${f.field}`]: "" });
        else await doc.unsetFlag(MODULE_ID, SCENE_LINK_FLAG);
      }),
  });

  registerRepairCheck({
    id: "location.vaultSweep",
    label: key("vaultSweep.label"),
    hint: key("vaultSweep.hint"),
    order: 20,
    requires: () => game.system?.id === "acks",
    scan: () =>
      planVaultSweep().map(({ character, pending, banked }) => ({
        key: character.uuid,
        uuid: character.uuid,
        name: character.name,
        detail: [
          pending.length ? loc("repair.check.vaultSweep.pending", { coin: coinText(pending) }) : "",
          banked.length ? loc("repair.check.vaultSweep.banked", { coin: coinText(banked) }) : "",
        ].filter(Boolean).join(" "),
      })),
    fix: (findings) =>
      fixEach(findings, async (f) => {
        const { gp } = await runVaultSweep({ announce: false, only: new Set([f.uuid]) });
        return loc("repair.check.vaultSweep.done", { gp: Math.round(gp * 100) / 100 });
      }),
  });

  registerRepairCheck({
    id: "location.orphanVaults",
    label: key("orphanVaults.label"),
    hint: key("orphanVaults.hint"),
    order: 30,
    scan: () => {
      const out = [];
      const where = loc("repair.check.orphanVaults.reason");
      for (const place of providers()) {
        const vaultOf = vaultOwnerUuid(place);
        if (vaultOf && !resolveActorSync(vaultOf)) {
          out.push({ key: `vault:${place.uuid}`, uuid: place.uuid, name: place.name, detail: loc("repair.check.orphanVaults.vault"), reason: where });
        }
        for (const bucket of storesByOwner(place).values()) {
          if (!bucket.ownerUuid || resolveActorSync(bucket.ownerUuid)) continue;
          out.push({
            key: `goods:${place.uuid}:${bucket.ownerUuid}`,
            uuid: place.uuid,
            name: place.name,
            detail: loc("repair.check.orphanVaults.goods", { count: bucket.items.length, owner: bucket.ownerName || "?" }),
            reason: where,
          });
        }
      }
      return out;
    },
  });
}
