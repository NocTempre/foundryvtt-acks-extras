/* global canvas, ui, document, Hooks, PIXI, CONST, getComputedStyle */
/**
 * A seat's click on a door of the scene in view: `pickDoor` arms the shared
 * pointer catcher (`pointer-catcher.mjs`) over the board, so a press never
 * reaches core's door control and no door toggles. A left press on one of the
 * offered doors answers it, Enter answers "no door" and a right press or Escape
 * cancels. A banner on the page says what to press (its words are the caller's).
 *
 * Which doors are offered, which one a press hit and whether it is within reach
 * are plain data in and out (`offeredDoors`, `doorAt`, `judgeDoor`); only
 * `pickDoor` touches the canvas and the page.
 *
 * Reach is measured as the GM's client measures it for a seal: from the centre
 * of the caster's token to the nearest point of the wall, by the scene grid. A
 * door beyond it is refused to a Player where the press lands and allowed to a
 * Judge with a warning, and a caster with no token on the scene cannot reach
 * any door, so both seats are refused.
 */
import { MODULE_ID } from "./constants.mjs";
import { buildPointerCatcher } from "./pointer-catcher.mjs";
import { nearestPointOnSegment } from "./wall-geometry.mjs";
import { centreOfToken, pointGapFeet } from "./distance-units.mjs";

/** Half the side of a door control's hit square, in scene units at a UI scale of one (core draws the square 44 wide around the door's midpoint). */
export const DOOR_HALF = 22;

/** Core's door-type numbers, read at the call so a host without them (a test) gets core's own. */
const doorTypes = () => ({ DOOR: globalThis.CONST?.WALL_DOOR_TYPES?.DOOR ?? 1, SECRET: globalThis.CONST?.WALL_DOOR_TYPES?.SECRET ?? 2 });

/** Whether a figure was passed as a range: a blank, a non-number and a negative are none, and a none is not measured. */
export const rangeStated = (rangeFeet) => rangeFeet !== null && rangeFeet !== undefined && rangeFeet !== "" && Number.isFinite(Number(rangeFeet)) && Number(rangeFeet) >= 0;

/**
 * The doors a seat is offered, from core's door controls: a control the seat
 * sees (`visible`, which core sets from the seat's vision), on a wall that holds
 * a door. A secret door is offered to a Judge only, whatever the control says,
 * since core's own visibility test lets it through where the scene has no token
 * vision.
 *
 * @param {Iterable<object>} controls  core's `DoorControl`s: `{visible, wall: {id, document: {door, c}}}`
 * @param {{isGM: boolean}} seat
 * @returns {Array<{wallId: string, secret: boolean, c: number[], centre: {x: number, y: number}}>}
 */
export function offeredDoors(controls, { isGM = false } = {}) {
  const k = doorTypes();
  const out = [];
  for (const control of controls ?? []) {
    const wall = control?.wall;
    const door = Number(wall?.document?.door);
    const c = wall?.document?.c;
    if (control?.visible !== true || !wall?.id) continue;
    if (door !== k.DOOR && door !== k.SECRET) continue;
    if (door === k.SECRET && !isGM) continue;
    if (!Array.isArray(c) || c.length < 4 || c.slice(0, 4).some((v) => !Number.isFinite(Number(v)))) continue;
    const [x0, y0, x1, y1] = c.map(Number);
    out.push({ wallId: String(wall.id), secret: door === k.SECRET, c: [x0, y0, x1, y1], centre: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } });
  }
  return out;
}

/**
 * The offered door a point falls on, the nearest where hit squares overlap.
 *
 * @param {Array<{centre: {x: number, y: number}}>} doors  `offeredDoors`' answer
 * @param {{x: number, y: number}} point  in scene coordinates
 * @param {number} half  half the side of a door's hit square, in scene units
 */
export function doorAt(doors, point, half) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
  let best = null;
  let bestD = Infinity;
  for (const door of doors ?? []) {
    const dx = Math.abs(point.x - door.centre.x);
    const dy = Math.abs(point.y - door.centre.y);
    if (dx > half || dy > half) continue;
    const d = Math.hypot(dx, dy);
    if (d < bestD) {
      best = door;
      bestD = d;
    }
  }
  return best;
}

/**
 * Whether a press on a door is carried out. `noToken`: the caster stands on no
 * token of the scene, which refuses both seats. `outOfRange`: past a stated
 * range, which refuses a Player and passes a Judge with `warn` set and `over`
 * true (the Judge's request then states no range). A gap that cannot be measured
 * reads as past it. A range not stated measures nothing.
 *
 * @param {{c: number[]}} door
 * @param {object} o
 * @param {boolean} o.isGM
 * @param {number|string|null} o.rangeFeet
 * @param {{x: number, y: number}|null} o.from  the centre of the caster's token on the scene
 * @param {(a: object, b: object) => number|null} o.measure  feet between two scene points
 * @returns {{ok: true, warn?: "outOfRange", over?: true}|{ok: false, reason: "noToken"|"outOfRange"}}
 */
export function judgeDoor(door, { isGM = false, rangeFeet = null, from = null, measure } = {}) {
  if (!from) return { ok: false, reason: "noToken" };
  if (!rangeStated(rangeFeet)) return { ok: true };
  const near = nearestPointOnSegment(from.x, from.y, door.c);
  const gap = measure?.(from, { x: near.x, y: near.y });
  if (Number.isFinite(gap) && gap <= Number(rangeFeet)) return { ok: true };
  return isGM ? { ok: true, warn: "outOfRange", over: true } : { ok: false, reason: "outOfRange" };
}

/** The token a pick measures from: the caster's token on the scene, by document or id, else the one of the caster's actor there. */
function casterTokenOn(scene, casterToken, caster) {
  const wanted = typeof casterToken === "string" ? scene.tokens?.get?.(casterToken) : casterToken;
  if (wanted && wanted.parent?.id === scene.id) return wanted;
  for (const token of scene.tokens ?? []) {
    if (caster?.uuid && token.actor?.uuid === caster.uuid) return token;
  }
  return null;
}

/** A page colour (`#rrggbb`) as the number PIXI takes; the fallback where the page gives none. */
function cssColour(name, fallback) {
  const raw = typeof getComputedStyle === "function" ? String(getComputedStyle(document.documentElement).getPropertyValue(name)).trim() : "";
  return /^#[0-9a-f]{6}$/i.test(raw) ? parseInt(raw.slice(1), 16) : fallback;
}

/** The pick in progress, ended when another opens. */
let active = null;

/**
 * Pick a door on the scene in view.
 *
 * Doors in reach are outlined and a door out of reach is dimmed. A refusal says
 * itself in the banner and in a notice and leaves the pick open. Nothing is
 * written. The catcher, the key listener and the banner are gone by the time
 * the answer arrives, and a scene torn down under the pick cancels it.
 *
 * @param {object} o
 * @param {Actor} o.caster  the casting actor, whose token measures reach where `casterToken` is not on the scene
 * @param {TokenDocument|string|null} o.casterToken  the caster's token, or its id on the scene
 * @param {number|string|null} [o.rangeFeet]  the farthest a door may be from the caster's token, in feet; none states no limit
 * @param {boolean} [o.isGM]  the seat is a Judge's
 * @param {{banner?: string, tip?: string, far?: string, refused?: (reason: string) => string}} [o.text]
 *   the page's words: the banner, its tooltip, a Judge's warning for a door past reach, and a refusal's text by reason
 * @returns {Promise<{wallId: string, sceneId: string, over?: true}|{skipped: true}|null>} the door; `skipped`
 *   for Enter; null for a cancel. `over` marks a Judge's press past the range
 */
export async function pickDoor({ caster = null, casterToken = null, rangeFeet = null, isGM = false, text = {} } = {}) {
  const scene = canvas?.scene;
  if (!scene || !canvas?.stage || !canvas?.app) return { skipped: true };
  active?.(null);
  const token = casterTokenOn(scene, casterToken, caster);
  const from = token ? centreOfToken(token) : null;
  const scale = Number(canvas.dimensions?.uiScale) || 1;
  const half = DOOR_HALF * scale;
  const doors = offeredDoors(canvas.controls?.doors?.children, { isGM });
  const measure = (a, b) => pointGapFeet(scene, a, b);
  const verdictOf = (door) => judgeDoor(door, { isGM, rangeFeet, from, measure });

  const container = canvas.stage.addChild(new PIXI.Container());
  const banner = openBanner(text);
  let hook = null;
  let onKey = null;
  let catcher = null;

  return new Promise((resolve) => {
    let finished = false;
    const finish = (answer) => {
      if (finished) return;
      finished = true;
      if (active === finish) active = null;
      if (onKey) document.removeEventListener("keydown", onKey, true);
      if (hook !== null) Hooks.off("canvasTearDown", hook);
      banner.remove();
      canvas.stage?.removeChild?.(container);
      container.destroy?.({ children: true });
      resolve(answer);
    };
    active = finish;
    try {
      const refuse = (reason) => {
        const words = text.refused?.(reason) ?? reason;
        banner.set(words, true);
        ui.notifications?.warn(words);
      };

      catcher = buildPointerCatcher(container, {
        down: (ev) => {
          ev.stopPropagation?.();
          const button = ev.button ?? ev.nativeEvent?.button ?? 0;
          if (button === 2) return finish(null);
          if (button !== 0) return;
          const door = doorAt(doors, ev.getLocalPosition(canvas.stage), half);
          if (!door) return;
          const verdict = verdictOf(door);
          if (!verdict.ok) return refuse(verdict.reason);
          if (verdict.warn) ui.notifications?.warn(text.far ?? verdict.warn);
          finish({ wallId: door.wallId, sceneId: scene.id, ...(verdict.over ? { over: true } : {}) });
        },
        move: (ev) => {
          catcher.cursor = doorAt(doors, ev.getLocalPosition(canvas.stage), half) ? "pointer" : "default";
        },
        up: (ev) => ev.stopPropagation?.(),
      });

      const outlines = container.addChild(new PIXI.Graphics());
      const gold = cssColour("--acks-spot", 0xff5500);
      for (const door of doors) {
        const reach = verdictOf(door);
        const near = reach.ok && !reach.warn;
        outlines.lineStyle(near ? 2 * scale : scale, near ? gold : 0x777777, near ? 1 : 0.5);
        outlines.drawRect(door.centre.x - half, door.centre.y - half, 2 * half, 2 * half);
      }

      onKey = (ev) => {
        if (ev.key !== "Enter" && ev.key !== "Escape") return;
        if (ev.target?.nodeType === 1 && ev.target.matches?.("input, textarea, select, [contenteditable]")) return;
        ev.preventDefault?.();
        ev.stopPropagation?.();
        finish(ev.key === "Enter" ? { skipped: true } : null);
      };
      document.addEventListener("keydown", onKey, true);
      hook = Hooks.on("canvasTearDown", () => finish(null));
    } catch (err) {
      console.error(`${MODULE_ID} | the door pick could not start`, err);
      finish({ skipped: true });
    }
  });
}

/**
 * The banner on the page: a status line that says what to press. `set` swaps
 * its words and marks a refusal; `remove` takes it away.
 */
function openBanner(text) {
  const el = document.createElement("div");
  el.className = "acks-extras-pick-banner";
  el.setAttribute("role", "status");
  const tag = document.createElement("span");
  tag.className = "acks-tag";
  tag.textContent = text.banner ?? "";
  if (text.tip) tag.dataset.tooltipText = text.tip;
  el.appendChild(tag);
  document.body.appendChild(el);
  return {
    set(words, refusal = false) {
      tag.textContent = words;
      tag.classList.toggle("acks-tag--danger", refusal);
    },
    remove() {
      el.remove();
    },
  };
}
