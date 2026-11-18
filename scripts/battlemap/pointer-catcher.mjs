/* global PIXI, canvas */
/**
 * The screen-covering pointer catcher the battlemap's canvas tools share (the
 * calibration capture and the terrain brush): an invisible sprite that swallows
 * every canvas pointer event while a tool is armed, whatever the pan and zoom.
 *
 * PIXI hears `pointermove` and `pointerup` on the whole document and
 * `pointerdown` on the board alone, so the catcher is handed events made over a
 * window, the sidebar or anything else in front of the board. Every tool reads
 * them through the one guard here: a press and a move reach a tool only over
 * the board, and a release reaches it with whether it happened there.
 */

/**
 * Whether a pointer event happened over the board canvas itself rather than
 * over a window, the sidebar or any other element in front of it. Read off
 * the native event's target, which is the element under the pointer; the
 * comparison is by identity, so it holds for a board in a detached window.
 */
export function onBoard(ev, board = canvas?.app?.view) {
  return !!board && ev?.nativeEvent?.target === board;
}

/**
 * Add the catcher to `container` and wire its handlers.
 *
 * @param {PIXI.Container} container  The tool's own container; the catcher is its first child.
 * @param {object} handlers
 * @param {(ev) => void} handlers.down  A press over the board.
 * @param {(ev) => void} handlers.move  A move over the board.
 * @param {(ev, over: boolean) => void} handlers.up  A release anywhere; `over` is
 *   whether it was over the board, so a stroke released over a window is told
 *   apart from one released on the map.
 * @returns {PIXI.Sprite} The catcher.
 */
export function buildPointerCatcher(container, { down, move, up }) {
  const catcher = container.addChild(new PIXI.Sprite(PIXI.Texture.WHITE));
  catcher.alpha = 0;
  catcher.eventMode = "static";
  catcher.hitArea = canvas.app.screen;
  catcher.updateTransform = function () {
    const screen = canvas.app.screen;
    this.width = screen.width;
    this.height = screen.height;
    this._boundsID++;
    this.transform.updateTransform(PIXI.Transform.IDENTITY);
    this.worldAlpha = this.alpha;
  };
  catcher.on("pointerdown", (ev) => {
    if (onBoard(ev)) down(ev);
  });
  catcher.on("pointermove", (ev) => {
    if (onBoard(ev)) move(ev);
  });
  const release = (ev) => up(ev, onBoard(ev));
  catcher.on("pointerup", release);
  catcher.on("pointerupoutside", release);
  return catcher;
}
