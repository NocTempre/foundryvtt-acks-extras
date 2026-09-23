/* global game, foundry, ui */
/**
 * The Judge's controls for a party that has lost its way: the navigation
 * card only reports, so this asks which way the party strayed and offers a
 * blind roll for a Judge who would rather not choose. See
 * docs/formation/MODEL.md, "Lost".
 */
import { makeLoc } from "../lib/util.mjs";
import { HEX_FACES, rollStrayFace, travelOf } from "./travel.mjs";
import { beginEpisode, discoverEpisode, endEpisode, reanchorEpisode } from "./lost-episode.mjs";
import { canFake } from "./lost-fog.mjs";
import { shadowsOf } from "./shadow.mjs";

const loc = makeLoc("ACKS-FORMATION");

/**
 * Where a party ends up after straying by one face.
 *
 * The grid's own neighbour order IS the face order, so a face index is an
 * index into it — no geometry of ours, and it stays right on any hex layout
 * Foundry supports.
 */
export function strayTo(scene, offset, face) {
  const neighbours = scene?.grid?.getAdjacentOffsets?.(offset) ?? [];
  if (!neighbours.length) return null;
  const n = ((Math.floor(Number(face)) % neighbours.length) + neighbours.length) % neighbours.length;
  return neighbours[n] ?? null;
}

/** The six faces, labelled for the picker. */
function faceChoices() {
  return Array.from({ length: HEX_FACES }, (_, i) => ({
    value: String(i),
    label: loc("lost.face", { n: i + 1 }),
  }));
}

/**
 * Ask which way the party wandered, then open the episode.
 *
 * The dialog is the only place the answer can come from, so it does not
 * default: a Judge who wants the dice presses the dice.
 */
export async function askStrayAndBegin(formation) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  const scene = game.scenes?.get(formation?.sceneId) ?? null;
  const t = travelOf(formation);
  const here = (t.hex?.i != null && t.hex?.j != null) ? { i: t.hex.i, j: t.hex.j } : null;
  if (!scene || !canFake(scene.id)) {
    ui.notifications?.warn(loc("lost.viewScene"));
    return null;
  }
  if (!DialogV2 || !here) {
    ui.notifications?.warn(loc("lost.needHex"));
    return null;
  }

  const choices = faceChoices()
    .map((c) => `<option value="${c.value}">${c.label}</option>`).join("");
  const content = `<p>${loc("lost.askBody")}</p>`
    + `<div class="form-group"><label>${loc("lost.askFace")}</label>`
    + `<div class="form-fields"><select name="face">${choices}</select></div></div>`
    + `<p class="hint">${loc("lost.askHint")}</p>`;

  const picked = await DialogV2.wait({
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    window: { title: loc("lost.askTitle"), icon: "fa-solid fa-compass-drafting" },
    content,
    buttons: [
      { action: "chosen", label: loc("lost.askChoose"), default: true,
        callback: (_e, button) => ({ face: Number(button.form.elements.face.value) }) },
      { action: "rolled", label: loc("lost.askRoll"), callback: () => ({ roll: true }) },
      { action: "cancel", label: loc("lost.askCancel"), callback: () => null },
    ],
    rejectClose: false,
  }).catch(() => null);

  if (!picked) return null;
  const face = picked.roll ? (await rollStrayFace()).face : picked.face;
  const trueOffset = strayTo(scene, here, face);
  if (!trueOffset) {
    ui.notifications?.warn(loc("lost.noNeighbour"));
    return null;
  }

  return beginEpisode(formation, {
    day: t.dayCount,
    anchor: here,
    trueOffset,
    judgeNote: loc("lost.note", { face: face + 1 }),
  });
}

/** They realise they are lost. Strict RAW: it gives back nothing else. */
export async function confirmDiscovery(formation) {
  return discoverEpisode(formation);
}

/**
 * A yes/no in the module's dialog frame. Resolves null on no, or
 * `{checked: {name: bool}}` for the checkboxes in the content, read before
 * the dialog closes.
 */
function ask(title, content, yes) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) return Promise.resolve(null);
  return DialogV2.wait({
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    window: { title, icon: "fa-solid fa-compass-drafting" },
    content,
    buttons: [
      {
        action: "yes", label: loc(yes), default: true,
        callback: (_e, button) => ({
          checked: Object.fromEntries(
            [...(button.form?.querySelectorAll('input[type="checkbox"]') ?? [])].map((i) => [i.name, i.checked]),
          ),
        }),
      },
      { action: "no", label: loc("lost.askCancel"), callback: () => null },
    ],
    rejectClose: false,
  }).catch(() => null);
}

/**
 * They find the landmark. The only ending that credits the ground they really
 * crossed, so it is a deliberate press rather than an automatic consequence.
 * The Judge chooses whether the party token steps onto its true position;
 * with no episode open, the press moves the party onto a leftover marker and
 * retires it.
 */
export async function confirmReanchor(formation) {
  const open = !!travelOf(formation).lost.phase;
  const hasShadow = shadowsOf(formation.id).length > 0;
  const move = hasShadow
    ? `<label class="checkbox"><input type="checkbox" name="moveToTruth" checked> ${loc("lost.reanchorMove")}</label>`
    : "";
  const picked = open
    ? await ask(loc("lost.reanchor"), `<p>${loc("lost.reanchorBody")}</p>${move}`, "lost.reanchorConfirm")
    : await ask(loc("lost.leftoverMove"), `<p>${loc("lost.leftoverMoveHint")}</p>`, "lost.leftoverMove");
  if (!picked) return null;
  const moveToTruth = open ? !!picked.checked.moveToTruth : true;
  return reanchorEpisode(formation, { moveToTruth });
}

/**
 * They turn back, or the Judge closes the episode: nothing is credited, the
 * party token stays, and the true-position marker goes. With no episode open,
 * the press only removes a leftover marker.
 */
export async function confirmEnd(formation) {
  const open = !!travelOf(formation).lost.phase;
  const picked = open
    ? await ask(loc("lost.end"), `<p>${loc("lost.endHint")}</p>`, "lost.end")
    : await ask(loc("lost.leftoverClear"), `<p>${loc("lost.leftoverClearHint")}</p>`, "lost.leftoverClear");
  if (!picked) return null;
  return endEpisode(formation);
}
