/* global game, canvas, ui, Hooks, PIXI, fromUuidSync */
import { MODULE_ID, TRAP_ZONE_TYPE } from "./constants.mjs";
import { STATES } from "./trap-rules.mjs";
import { wallTrap } from "./trap-walls.mjs";

/**
 * What a Judge can see of a trap, what the party has earned the right to, and
 * the two gestures that change either one.
 *
 * **Seeing it.** Modelled on the secret door, which is the closest thing the
 * system already has, and it has two stages. **Hidden:** while a trap is armed
 * and unfound a player is shown nothing at all — no icon, no wall, no hint that
 * the square is different — and only the Judge sees a marker. **Known:** once
 * the party has found the thing, sprung it, or disarmed it, the marker is
 * theirs too, and it says which state it is in — armed, spotted, disarmed,
 * spent — the same way a discovered secret door goes on to show whether it is
 * open or shut.
 *
 * The stage is `known`, not the state. A trap the thief disarmed and re-armed
 * reads `armed` again and is perfectly well known; a trap the Judge rebuilt
 * reads `armed` and is a fresh secret. Reading the stage off the state would
 * make the party forget a trap by re-arming it.
 *
 * A player's marker is the thing the Trapbreaking dialog points at, which is
 * why the two stages exist at all: a target you cannot see is a target you
 * cannot choose.
 *
 * **Working it.** For a Judge the marker is also the trap's CONTROL, and it
 * takes core's door gestures because a trap sits on a wall and a door is the
 * gesture already learned there: **left** sets the mechanism or makes it safe,
 * **right** decides whether the party can see it. Both are the Judge's hand
 * moving directly, never a throw — a throw is Trapbreaking and has its own
 * dialog.
 *
 * Drawn into the controls layer rather than onto the walls: a trap wall is
 * non-blocking and often lies on top of an ordinary wall or a door, so the
 * marker has to be visible when the Walls layer is not the active one.
 *
 * The gate is at the point of DRAWING, not a hide applied after the fact.
 * Nothing about an unfound trap reaches a player's client through this file.
 */

/** The glyph and colour each state is drawn in. */
const MARKS = Object.freeze({
  [STATES.armed]: { glyph: "▲", color: 0xa3312c }, // filled triangle, danger
  [STATES.found]: { glyph: "△", color: 0xc8862a }, // hollow triangle, spotted
  [STATES.disarmed]: { glyph: "✓", color: 0x4a7a46 }, // a tick, made safe
  [STATES.discharged]: { glyph: "×", color: 0x6b6b6b }, // spent, and grey
});

/**
 * The scene controls under which a Judge is editing traps.
 *
 * Marker clicks are live only here, which is the whole reason they are safe to
 * add: every other placeable in Foundry answers the mouse only on its own
 * layer, and a trap that answered it everywhere would disarm itself under a
 * mis-aimed token drag. Both controls are listed because a trap is laid on
 * either half — a wall, or a region — and the Judge is on the matching control
 * when they are working on one.
 */
const EDIT_CONTROLS = Object.freeze(["walls", "regions"]);

/** Is this client, right now, in a position to work a trap from its marker? */
const canWorkTraps = () => !!game.user?.isGM && EDIT_CONTROLS.includes(ui.controls?.control?.name);

let layer = null;
let label = null;

/** The container the markers live in, created on first use. */
function markerLayer() {
  if (layer && !layer.destroyed) return layer;
  layer = new PIXI.Container();
  // `passive`, not `none`: the container itself must never swallow a click
  // meant for the map, while the controls inside it still have to hear one.
  layer.eventMode = "passive";
  canvas.controls.addChild(layer);
  return layer;
}

/* -------------------------------------------- */
/*  One marker                                  */
/* -------------------------------------------- */

/**
 * Build one trap's marker — and, for a Judge in trap-editing mode, its control.
 *
 * A factory rather than a `PIXI.Container` subclass: this file is imported by
 * the offline suite, where PIXI does not exist, and a class extending it would
 * be evaluated at load. Everything the gestures need is closed over instead.
 *
 * The DOCUMENTS are what is captured, never a placement. A marker outlives
 * several changes to the trap beneath it, and a state read at draw time is a
 * state that can be acted on after it has moved on — so a gesture reads the
 * document again before it writes.
 *
 * @param {object} mark the marker's state, position and what it stands for
 * @param {boolean} interactive may this client work the trap from here?
 * @returns {PIXI.Container}
 */
function makeTrapControl(mark, interactive) {
  const { state, known, trapUuid, target } = mark;
  const glyphMark = MARKS[state] ?? MARKS[STATES.armed];
  const size = Math.max(16, (canvas.grid?.size ?? 100) * 0.34);
  const box = size * 1.3;

  const control = new PIXI.Container();
  control.position.set(mark.x, mark.y);

  const bg = control.addChild(new PIXI.Graphics());
  bg.beginFill(0x000000, 1).drawRoundedRect(-box / 2, -box / 2, box, box, box * 0.2).endFill();
  bg.alpha = 0;

  // A ring says the PARTY can see this one. Drawn for the Judge only: every
  // marker a player is shown is known by definition, so a ring there would
  // mark the only kind of trap they ever get.
  if (known && game.user?.isGM) {
    control.addChild(new PIXI.Graphics())
      .lineStyle(Math.max(1.5, size * 0.07), glyphMark.color, 0.9)
      .drawCircle(0, 0, box * 0.56);
  }

  const glyph = control.addChild(
    new PIXI.Text(glyphMark.glyph, {
      fontFamily: "Signika, sans-serif",
      fontSize: size,
      fill: glyphMark.color,
      stroke: 0x000000,
      strokeThickness: Math.max(2, size * 0.14),
    }),
  );
  glyph.anchor.set(0.5);

  const border = control.addChild(new PIXI.Graphics());
  border.lineStyle(Math.max(1, size * 0.05), 0xff5500, 0.8).drawRoundedRect(-box / 2, -box / 2, box, box, box * 0.2);
  border.visible = false;

  /** What the hover readout says about this trap. */
  control.readout = () => {
    let name = "";
    try {
      name = (trapUuid ? fromUuidSync(trapUuid)?.name : "") ?? "";
    } catch {
      name = "";
    }
    return game.i18n.format("ACKS-FORMATION.traps.markerLabel", {
      trap: name || game.i18n.localize("ACKS-FORMATION.traps.markerNoTrap"),
      state: game.i18n.localize(`ACKS-FORMATION.traps.state.${state}`),
      seen: game.i18n.localize(known ? "ACKS-FORMATION.traps.markerSeen" : "ACKS-FORMATION.traps.markerUnseen"),
    });
  };

  if (!interactive) {
    control.eventMode = "none";
    return control;
  }

  /**
   * The placement this marker stands for, read fresh — or null once the
   * document behind it is gone. A marker survives a hook or two past a deleted
   * wall, and a gesture landing in that window must do nothing rather than
   * write to a corpse.
   *
   * `trap-zone.mjs` declares a RegionBehaviorType subclass as it loads, so it
   * cannot be imported where Foundry is absent — and this file is. Taken at the
   * point of use, where the world exists and the module is already resolved.
   */
  const placement = async () => {
    const { wallPlacement, zonePlacement } = await import("./trap-zone.mjs");
    if (target.kind === "wall") return target.wall?.parent ? wallPlacement(target.wall) : null;
    return target.behavior?.parent ? zonePlacement({ region: target.region, behavior: target.behavior }) : null;
  };

  /** Run a gesture's work, re-checking the gate and swallowing nothing. */
  const run = (work) => {
    if (!canWorkTraps()) return;
    hideLabel();
    placement()
      .then((p) => (p ? work(p) : null))
      .catch((err) => console.error(`${MODULE_ID} | trap marker gesture failed`, err));
  };

  control.eventMode = "static";
  control.interactiveChildren = false;
  control.hitArea = new PIXI.Rectangle(-box / 2, -box / 2, box, box);
  control.cursor = "pointer";

  control.on("pointerover", (event) => {
    event.stopPropagation();
    border.visible = true;
    bg.alpha = 0.3;
    showLabel(control);
  });
  control.on("pointerout", (event) => {
    event.stopPropagation();
    border.visible = false;
    bg.alpha = 0;
    hideLabel();
  });

  // Left: set the mechanism, or make it safe.
  control.on("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    run(async (p) => {
      const { toggleArmed } = await import("./trap-zone.mjs");
      const was = p.state;
      await toggleArmed(p);
      const key = was === STATES.armed ? "markerDisarmed" : was === STATES.discharged ? "markerRebuilt" : "markerArmed";
      ui.notifications?.info(game.i18n.localize(`ACKS-FORMATION.traps.${key}`));
    });
  });

  // Right: show the trap to the party, or take it back out of sight.
  control.on("rightdown", (event) => {
    event.stopPropagation();
    run(async (p) => {
      const { toggleKnown } = await import("./trap-zone.mjs");
      await toggleKnown(p);
      ui.notifications?.info(
        game.i18n.localize(p.known ? "ACKS-FORMATION.traps.markerHiddenNow" : "ACKS-FORMATION.traps.markerRevealed"),
      );
    });
  });

  return control;
}

/* -------------------------------------------- */
/*  The hover readout                           */
/* -------------------------------------------- */

/**
 * Name the trap, its state and who can see it, above the marker under the
 * cursor.
 *
 * One shared text object rather than one per marker: a scene can hold a dozen
 * traps and only ever one is hovered, and a marker is redrawn wholesale on
 * every change.
 */
function showLabel(control) {
  const container = markerLayer();
  if (!label || label.destroyed) {
    label = container.addChild(
      new PIXI.Text("", {
        fontFamily: "Signika, sans-serif",
        fontSize: Math.max(13, (canvas.grid?.size ?? 100) * 0.16),
        fill: 0xffffff,
        stroke: 0x000000,
        strokeThickness: 4,
        align: "center",
      }),
    );
    label.anchor.set(0.5, 1);
    label.eventMode = "none";
  }
  label.text = control.readout();
  label.position.set(control.position.x, control.position.y - (canvas.grid?.size ?? 100) * 0.28);
  label.visible = true;
  container.setChildIndex(label, container.children.length - 1);
}

/** Take the hover readout away. */
function hideLabel() {
  if (label && !label.destroyed) label.visible = false;
}

/* -------------------------------------------- */
/*  The whole scene                             */
/* -------------------------------------------- */

/**
 * Redraw every trap marker on the current scene.
 *
 * Cheap enough to run wholesale on any change: a scene holds a handful of
 * traps, and rebuilding is the only way to be certain a marker for a deleted
 * wall does not survive its wall.
 */
export function refreshTrapMarkers() {
  if (!canvas?.ready) return;
  const container = markerLayer();
  container.removeChildren().forEach((child) => child.destroy({ children: true }));
  label = null;
  // The gate, applied once: a Judge sees every trap, everyone else sees only
  // the ones the party has found.
  const gm = game.user.isGM;
  const interactive = canWorkTraps();
  container.interactiveChildren = interactive;

  const marks = [];
  for (const wall of canvas.scene?.walls ?? []) {
    const trap = wallTrap(wall);
    if (!trap) continue;
    if (!gm && !trap.known) continue;
    const [x1, y1, x2, y2] = wall.c;
    marks.push({
      x: (x1 + x2) / 2,
      y: (y1 + y2) / 2,
      state: trap.state,
      known: trap.known,
      trapUuid: trap.trapUuid,
      target: { kind: "wall", wall },
    });
  }
  for (const region of canvas.scene?.regions ?? []) {
    const behavior = region.behaviors.find((b) => b.type === TRAP_ZONE_TYPE && !b.disabled);
    if (!behavior) continue;
    if (!gm && !behavior.system.known) continue;
    const at = regionCentre(region);
    if (!at) continue;
    marks.push({
      x: at.x,
      y: at.y,
      state: behavior.system.state,
      known: !!behavior.system.known,
      trapUuid: behavior.system.trapUuid ?? "",
      target: { kind: "zone", region, behavior },
    });
  }

  for (const mark of spread(marks)) container.addChild(makeTrapControl(mark, interactive));
}

/**
 * Nudge markers that land on the same spot into a row.
 *
 * A trap on a door already shares its midpoint with core's own door control,
 * and two traps can share a midpoint with each other — a wall trapped along a
 * region's edge, or two segments drawn over one another. Stacked glyphs read as
 * one, so the Judge sees a single trap where there are two and cannot tell
 * which state belongs to which.
 *
 * Laid out left to right around the shared point, so the row stays centred on
 * the thing it marks rather than drifting off it.
 */
export function spread(marks, gap = 18) {
  const buckets = new Map();
  for (const mark of marks) {
    // Quantised to the gap so "near enough to overlap" groups, not just exact
    // ties — two wall midpoints a pixel apart still collide visually.
    const key = `${Math.round(mark.x / gap)}:${Math.round(mark.y / gap)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(mark);
  }
  const out = [];
  for (const group of buckets.values()) {
    const offset = ((group.length - 1) * gap) / 2;
    group.forEach((mark, i) => out.push({ ...mark, x: mark.x - offset + i * gap }));
  }
  return out;
}

/**
 * The middle of a region's first solid shape.
 *
 * The average of a polygon's vertices rather than its true centroid: for the
 * rectangles and rough loops a Judge draws round a trap the two are close
 * enough, and this one cannot divide by a zero area.
 */
function regionCentre(region) {
  const shape = (region.shapes ?? []).find((s) => !s.hole);
  if (!shape) return null;
  switch (shape.type) {
    case "rectangle":
      return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
    case "circle":
    case "ellipse":
      return { x: shape.x, y: shape.y };
    case "polygon": {
      const pts = shape.points ?? [];
      if (pts.length < 2) return null;
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < pts.length; i += 2) {
        sx += pts[i];
        sy += pts[i + 1];
      }
      const n = pts.length / 2;
      return { x: sx / n, y: sy / n };
    }
    default:
      return null;
  }
}

/** Redraw whenever the scene, its walls, its regions, or the active tool change. */
export function installTrapMarkers() {
  const redraw = () => {
    try {
      refreshTrapMarkers();
    } catch (err) {
      console.error(`${MODULE_ID} | trap markers failed`, err);
    }
  };
  Hooks.on("canvasReady", redraw);
  // Switching scene control puts the Judge into or out of trap-editing mode,
  // which is what decides whether the markers answer the mouse at all.
  Hooks.on("renderSceneControls", redraw);
  for (const hook of [
    "createWall",
    "updateWall",
    "deleteWall",
    "createRegion",
    "updateRegion",
    "deleteRegion",
    "createRegionBehavior",
    "updateRegionBehavior",
    "deleteRegionBehavior",
  ]) {
    Hooks.on(hook, redraw);
  }
}
