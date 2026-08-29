/* global game, canvas, ui, PIXI */
/**
 * Drawing the road network: click a node, click another, that is a link.
 *
 * The terrain brush paints CELLS; this connects NODES, so it cannot be the
 * same gesture. A link needs two ends, which makes the tool stateful in a way
 * a fill never is: the first click anchors, the second completes, and a
 * right-click clears the anchor or removes an existing link.
 *
 * The anchor is deliberately visible. A tool that remembered a click without
 * showing it would leave a Judge guessing whether their last press registered,
 * and the fix — clicking again — would silently draw a link they did not want.
 */
import { makeLoc } from "../lib/util.mjs";
import { isHexScene } from "./terrain-paint.mjs";
import { nodeAtPoint, declareLink, removeLink, routesOf } from "./hex-routes.mjs";
import { parseNode } from "./hex-topology.mjs";

const LANG_PREFIX = "ACKS-BATTLEMAP";
const loc = makeLoc(LANG_PREFIX);

/** The road kinds a link can be. Structural — their worth is imported. */
export const LINK_ROADS = Object.freeze(["earth", "gravel", "paved"]);

class RoutePaintSession {
  /** The node a first click anchored, or null. */
  #anchor = null;
  /** The road kind the next link is drawn as. */
  road = "earth";
  /** How winding the next link is: 1 is straight across. */
  winding = 1;
  #container = null;
  #overlay = null;

  get anchor() { return this.#anchor; }
  get armed() { return !!this.#container; }

  arm(road = "earth") {
    this.road = LINK_ROADS.includes(road) ? road : "earth";
    if (this.#container) return this.#redraw();
    this.#install();
  }

  disarm() {
    this.#anchor = null;
    this.#container?.destroy({ children: true });
    this.#container = null;
    this.#overlay = null;
  }

  #install() {
    if (!canvas?.ready) return;
    const container = canvas.controls.addChild(new PIXI.Container());
    this.#container = container;
    this.#overlay = container.addChild(new PIXI.Graphics());

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
      if (ev.data?.button === 2) this.#onRight(ev);
      else this.#onLeft(ev);
    });
    this.#redraw();
  }

  /** Where on the canvas this event landed, in scene coordinates. */
  #pointOf(ev) {
    return ev.data.getLocalPosition(canvas.stage);
  }

  async #onLeft(ev) {
    const scene = canvas.scene;
    if (!isHexScene(scene)) {
      ui.notifications?.warn(loc("terrain.hexOnly"));
      return;
    }
    const node = nodeAtPoint(scene, this.#pointOf(ev));
    if (!node) return;

    if (!this.#anchor) {
      this.#anchor = node;
      this.#redraw();
      return;
    }
    if (this.#anchor === node) {
      // Clicking the anchor again releases it rather than drawing nothing.
      this.#anchor = null;
      this.#redraw();
      return;
    }
    await declareLink(scene, this.#anchor, node, { road: this.road, winding: this.winding });
    // Chain: the far end becomes the next anchor, so a road is drawn in one
    // sweep rather than re-clicking every junction.
    this.#anchor = node;
    this.#redraw();
  }

  async #onRight(ev) {
    const scene = canvas.scene;
    if (this.#anchor) {
      const node = nodeAtPoint(scene, this.#pointOf(ev));
      if (node && node !== this.#anchor) await removeLink(scene, this.#anchor, node);
      this.#anchor = null;
    }
    this.#redraw();
  }

  /** Draw the network, and the anchor waiting for its far end. */
  #redraw() {
    const g = this.#overlay;
    const scene = canvas?.scene;
    if (!g || !scene) return;
    g.clear();

    const at = (id) => {
      const n = parseNode(id);
      if (!n) return null;
      const offset = { i: n.i, j: n.j };
      const centre = scene.grid.getCenterPoint(offset);
      if (n.kind === "centre") return centre;
      const v = scene.grid.getVertices?.(offset) ?? [];
      if (!v.length) return centre;
      if (n.kind === "corner") return v[n.index % v.length];
      const a = v[n.index % v.length];
      const b = v[(n.index + 1) % v.length];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };

    for (const link of routesOf(scene)) {
      const p = at(link.a);
      const q = at(link.b);
      if (!p || !q) continue;
      g.lineStyle(6, ROAD_TINT[link.road] ?? ROAD_TINT.earth, 0.9);
      g.moveTo(p.x, p.y);
      g.lineTo(q.x, q.y);
    }

    if (this.#anchor) {
      const p = at(this.#anchor);
      if (p) {
        g.lineStyle(3, 0xffffff, 1);
        g.drawCircle(p.x, p.y, 14);
      }
    }
  }
}

/** Road tints. Presentation, not rules — the same footing as the terrain palette. */
const ROAD_TINT = Object.freeze({ earth: 0x8a6a44, gravel: 0xa8a094, paved: 0xd8d2c6 });

/** The one session, so a second arming does not stack overlays. */
export const routePaint = new RoutePaintSession();
