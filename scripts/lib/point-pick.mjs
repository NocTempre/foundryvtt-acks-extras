/* global canvas, ui, document, Hooks, PIXI */
/**
 * A seat's one click on a point of the scene in view: `pickPoint` arms the shared
 * pointer catcher (`pointer-catcher.mjs`) over the board, so a press never reaches
 * a token or a control beneath it. A left press answers `{sceneId, x, y}` in scene
 * coordinates; a right press or Escape cancels. A banner on the page says what to
 * press (its words are the caller's). Nothing is written, and the catcher, the key
 * listener and the banner are gone by the time the answer arrives; a scene torn
 * down under the pick cancels it.
 */
import { MODULE_ID } from "./constants.mjs";
import { buildPointerCatcher } from "./pointer-catcher.mjs";

/**
 * A pointer position as a scene point: rounded to a whole unit, or null where
 * either coordinate is no number.
 *
 * @param {{x: number, y: number}|null|undefined} local
 * @returns {{x: number, y: number}|null}
 */
export function scenePoint(local) {
  const x = Number(local?.x);
  const y = Number(local?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x: Math.round(x), y: Math.round(y) } : null;
}

/** The pick in progress, ended when another opens. */
let active = null;

/**
 * Pick a point on the scene in view.
 *
 * @param {{text?: {banner?: string, tip?: string}}} [o] the page's words: the banner and its tooltip
 * @returns {Promise<{sceneId: string, x: number, y: number}|null>} the point, or null for a cancel or a board that is not up
 */
export function pickPoint({ text = {} } = {}) {
  const scene = canvas?.scene;
  if (!scene || !canvas?.stage || !canvas?.app) return Promise.resolve(null);
  active?.(null);
  const container = canvas.stage.addChild(new PIXI.Container());
  const banner = document.createElement("div");
  banner.className = "acks-extras-pick-banner";
  banner.setAttribute("role", "status");
  const tag = document.createElement("span");
  tag.className = "acks-tag";
  tag.textContent = text.banner ?? "";
  if (text.tip) tag.dataset.tooltipText = text.tip;
  banner.appendChild(tag);
  document.body.appendChild(banner);
  let hook = null;
  let onKey = null;
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
      buildPointerCatcher(container, {
        down: (ev) => {
          ev.stopPropagation?.();
          const button = ev.button ?? ev.nativeEvent?.button ?? 0;
          if (button === 2) return finish(null);
          if (button !== 0) return;
          const point = scenePoint(ev.getLocalPosition(canvas.stage));
          if (point) finish({ sceneId: scene.id, ...point });
        },
        move: () => {},
        up: (ev) => ev.stopPropagation?.(),
      });
      onKey = (ev) => {
        if (ev.key !== "Escape") return;
        ev.preventDefault?.();
        ev.stopPropagation?.();
        finish(null);
      };
      document.addEventListener("keydown", onKey, true);
      hook = Hooks.on("canvasTearDown", () => finish(null));
    } catch (err) {
      console.error(`${MODULE_ID} | the point pick could not start`, err);
      finish(null);
    }
  });
}
