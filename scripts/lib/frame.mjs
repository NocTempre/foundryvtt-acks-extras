/**
 * The sheet frame: the one vocabulary every actor sheet of this module draws
 * with — a title band in the window header, an art row of rail cells around
 * the portrait, a tab strip with a fold, and a folded card of pins — stated
 * once here and in `styles/lib-frame.css`, `templates/lib/frame/` and
 * `frame-model.mjs`. The character sheet is its first consumer; the Full
 * Monster sheet, the Follower Card and the roster draw with the same classes.
 */

/** The frame's root class: the stylesheet's every selector hangs off it or its `__` members. */
export const FRAME_CLASS = "acks-extras-frame";
