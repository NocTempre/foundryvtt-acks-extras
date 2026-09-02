/* global game, canvas, foundry */
/**
 * The Judge's controls for a party that has lost its way.
 *
 * The navigation card can only ever report. RAW hands the STRAY DIRECTION to a
 * person — "based on the landmarks and terrain, or randomly" — so the module
 * asks rather than choosing, and offers the blind roll for a Judge who would
 * rather not.
 *
 * Without this the whole lost feature was unreachable: the ledger, the shadow
 * and the faked reveal all existed and nothing could start them.
 */
import { makeLoc } from "../lib/util.mjs";
import { HEX_FACES, rollStrayFace, travelOf } from "./travel.mjs";
import { beginEpisode, discoverEpisode, reanchorEpisode } from "./lost-episode.mjs";

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
  const scene = canvas?.scene;
  const t = travelOf(formation);
  const here = (t.hex?.i != null && t.hex?.j != null) ? { i: t.hex.i, j: t.hex.j } : null;
  if (!DialogV2 || !scene || !here) {
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
 * They find the landmark. The only ending that credits the ground they really
 * crossed, so it is a deliberate press rather than an automatic consequence.
 */
export async function confirmReanchor(formation) {
  return reanchorEpisode(formation);
}
