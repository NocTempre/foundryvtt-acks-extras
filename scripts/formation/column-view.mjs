/* global canvas, foundry, game, Hooks, PIXI */
/**
 * The marching column drawn behind a party token, and its lights, on every
 * client.
 *
 * One state per linked party token on the viewed scene: a PIXI container of
 * one tinted square and one portrait per body, and the column's light sources
 * (`column-light.mjs`). Each frame a party token refreshes, the column is laid
 * again from the stored trail, the move this client was told about, and the
 * token's live position (`column.mjs` `columnFor`), so the bodies follow the
 * head around a corner while it walks.
 *
 * Drawn only in the `order` shape, on a scene that lays a column. Lights
 * shine in both shapes. The container sits in `canvas.controls`, which fog
 * does not mask, so a player's seat shows each body only where that seat can
 * see its cell, and nothing at all while the party token is hidden from it.
 *
 * Factories, not PIXI subclasses: the offline suite imports this file, where
 * PIXI does not exist.
 */
import { FLAG_FORMATION_ID, FLAG_TRAIL, MODULE_ID, SETTING_PARTY_TOKEN_SHAPE } from "./constants.mjs";
import { columnFor, memberCells, pathCells } from "./column.mjs";
import { destroyColumnLights, syncColumnLights } from "./column-light.mjs";
import { getMemberActor, isLinkedPartyToken, partyTokenShape, readFormations, SETTING_FORMATIONS } from "./formation-model.mjs";

/** Opacity of a body's tint square. */
const TINT_ALPHA = 0.28;
/** Opacity of a body's portrait. */
const GLYPH_ALPHA = 0.85;
/** A portrait's size as a share of the cell. */
const GLYPH_SCALE = 0.7;

/** tokenId → per-token state. */
const states = new Map();
let root = null;

/** The container every column is drawn in, created on first use. */
function columnRoot() {
  if (root && !root.destroyed) return root;
  root = new PIXI.Container();
  root.eventMode = "none";
  canvas.controls.addChild(root);
  return root;
}

/** The stored record this token is the linked party token of, read-only; else null. */
function linkedRecord(doc) {
  const id = doc?.getFlag?.(MODULE_ID, FLAG_FORMATION_ID);
  const record = id ? readFormations()[id] : null;
  return record && isLinkedPartyToken(record, doc) ? record : null;
}

/** A `#rrggbb` string as a PIXI colour number, or null. */
function hexColor(text) {
  return /^#[0-9a-f]{6}$/i.test(text ?? "") ? Number.parseInt(text.slice(1), 16) : null;
}

/** The image a member's portrait shows: their token art, else their portrait. */
function memberImage(member) {
  const actor = member?.actorId ? getMemberActor(member) : null;
  return actor?.prototypeToken?.texture?.src ?? actor?.img ?? null;
}

/** Drop one token's state: its drawing and its light sources. */
function drop(tokenId) {
  const state = states.get(tokenId);
  if (!state) return;
  destroyColumnLights(state);
  state.container?.destroy({ children: true });
  states.delete(tokenId);
}

/**
 * Rebuild a state's glyphs when what they show changed: the bodies, who they
 * are, or the tint. Otherwise they are only moved.
 */
function ensureGlyphs(state, formation, token, count) {
  const tint = hexColor(formation.columnColor) ?? token.getDispositionColor?.() ?? 0xffffff;
  const owners = memberCells(formation, Array.from({ length: count }, () => null)).flatMap((cells, i) => cells.map(() => i));
  const key = JSON.stringify([tint, owners, (formation.members ?? []).map((m) => m?.actorId ?? null)]);
  if (state.key === key && state.container && !state.container.destroyed) return;
  state.container?.destroy({ children: true });
  state.key = key;
  const container = columnRoot().addChild(new PIXI.Container());
  container.eventMode = "none";
  state.container = container;
  state.bodies = owners.map((memberIndex, body) => {
    const cell = container.addChild(new PIXI.Container());
    const square = cell.addChild(new PIXI.Graphics());
    square.beginFill(tint, TINT_ALPHA).drawRect(0, 0, 1, 1).endFill();
    let glyph = null;
    // The head's own portrait is the party token itself.
    const src = body > 0 ? memberImage(formation.members[memberIndex]) : null;
    if (src) {
      glyph = cell.addChild(new PIXI.Sprite(PIXI.Texture.EMPTY));
      glyph.alpha = GLYPH_ALPHA;
      glyph.anchor.set(0.5);
      const known = foundry.canvas.getTexture?.(src);
      if (known) glyph.texture = known;
      else foundry.canvas.loadTexture?.(src).then((tex) => { if (tex && !glyph.destroyed) glyph.texture = tex; }).catch(() => null);
    }
    return { cell, square, glyph };
  });
}

/** Lay the glyphs on their cells and decide what this seat may see. */
function placeGlyphs(state, cells, token, gs) {
  const gm = !!game.user?.isGM;
  const shown = gm || token.visible;
  state.container.visible = !!shown;
  if (!shown) return;
  state.bodies.forEach(({ cell, square, glyph }, i) => {
    const at = cells[i];
    if (!at) {
      cell.visible = false;
      return;
    }
    cell.position.set(at.x, at.y);
    square.scale.set(gs, gs);
    if (glyph) {
      glyph.position.set(gs / 2, gs / 2);
      const side = gs * GLYPH_SCALE;
      const tex = glyph.texture;
      const fit = tex?.width && tex?.height ? side / Math.max(tex.width, tex.height) : 0;
      glyph.scale.set(fit, fit);
    }
    cell.visible = gm || canvas.visibility.testVisibility({ x: at.x + gs / 2, y: at.y + gs / 2 }, { tolerance: gs * 0.25 });
  });
}

/**
 * Lay one party token's column again and bring its drawing and lights into
 * line. Anything that is not a linked party token is dropped.
 * @param {Token} token the placeable
 */
export function refreshColumn(token) {
  const doc = token?.document;
  if (!doc || token.destroyed || !canvas.ready || doc.parent?.id !== canvas.scene?.id) return;
  const formation = linkedRecord(doc);
  if (!formation) return void drop(doc.id);
  let state = states.get(doc.id);
  if (!state) states.set(doc.id, (state = { lights: new Map(), path: null, key: null, container: null, bodies: [] }));
  const at = columnFor(formation, doc, { live: true, path: state.path });
  if (!at) return void drop(doc.id);
  syncColumnLights(state, formation, token, at.cells);
  const drawn = at.column && partyTokenShape(formation) === "order";
  if (!drawn) {
    state.container?.destroy({ children: true });
    state.container = null;
    state.key = null;
    return;
  }
  ensureGlyphs(state, formation, token, at.cells.length);
  placeGlyphs(state, at.cells, token, Number(doc.parent.grid.size));
}

/** Lay every party token on the viewed scene again. */
export function refreshAllColumns() {
  if (!canvas?.ready) return;
  for (const token of canvas.tokens?.placeables ?? []) {
    if (token.document?.getFlag?.(MODULE_ID, FLAG_FORMATION_ID) || states.has(token.document?.id)) refreshColumn(token);
  }
}

/** Throw away every state, drawing and source alike. */
function dropAll() {
  for (const id of [...states.keys()]) drop(id);
  root?.destroy({ children: true });
  root = null;
}

/** Wire the column to the canvas. Called once, at `init`. */
export function installColumnView() {
  Hooks.on("canvasReady", () => {
    dropAll();
    refreshAllColumns();
  });
  Hooks.on("canvasTearDown", dropAll);
  // Every frame of a move, and every other redraw of the token.
  Hooks.on("refreshToken", (token) => {
    if (states.has(token.document?.id) || token.document?.getFlag?.(MODULE_ID, FLAG_FORMATION_ID)) refreshColumn(token);
  });
  // The path a move takes, as this client was told it: the column follows it
  // around corners before the trail recording the move is written.
  Hooks.on("moveToken", (doc, movement) => {
    const state = states.get(doc.id);
    const gs = Number(doc.parent?.grid?.size);
    if (!state || !(gs > 0)) return;
    state.path = pathCells([movement.origin, ...(movement.passed?.waypoints ?? [])], gs);
  });
  Hooks.on("updateToken", (doc, changes) => {
    const state = states.get(doc.id);
    if (!state && !doc.getFlag?.(MODULE_ID, FLAG_FORMATION_ID)) return;
    // The trail now holds the move: the path is spent.
    if (state && foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${FLAG_TRAIL}`)) state.path = null;
    if (doc.object) refreshColumn(doc.object);
  });
  Hooks.on("deleteToken", (doc) => drop(doc.id));
  // The records carry the members, their lights, the shape and the tint.
  const onSetting = (setting) => {
    const key = setting?.key;
    if (key === `${MODULE_ID}.${SETTING_FORMATIONS}` || key === `${MODULE_ID}.${SETTING_PARTY_TOKEN_SHAPE}` || key === `${MODULE_ID}.syncTokenLight`) refreshAllColumns();
  };
  Hooks.on("createSetting", onSetting);
  Hooks.on("updateSetting", onSetting);
  // What this seat sees moved: show and hide bodies again.
  Hooks.on("sightRefresh", () => {
    if (game.user?.isGM) return;
    for (const id of states.keys()) {
      const token = canvas.tokens?.get(id);
      if (token) refreshColumn(token);
    }
  });
  // A full re-initialisation of the scene's light: make sure the column's
  // sources stand where the column does.
  Hooks.on("initializeLightSources", () => refreshAllColumns());
}
