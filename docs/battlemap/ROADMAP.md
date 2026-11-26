# Battlemap — roadmap

Re-issued 2026-11-14.

1. **Formation auto-squeeze.** Built in the formation column: a file a wall
   shuts out goes to the other hand or the next rank (`docs/formation/MODEL.md`,
   "The column"), and the trap sequence reads the squeezed ranks. What remains
   of it, a per-formation toggle to march unsqueezed, is in
   `docs/formation/ROADMAP.md` (the corridor-width row).
2. **Hex token behaviour.** Hex OUTPUT ships (DECISIONS 2026-08-30 and
   2026-11-15): the family is chosen, the grid is fitted to every box drawn
   around a single hex, and the shift lands the drawn hexes on real ones. What
   is not built is the token half of the
   2026-08-19 ruling — tokens that resize and auto-arrange to fill a hex as its
   occupancy changes, an optional fixed "slots-per-cell" override, and a
   show-all button. A hex scene sizes tokens by the same quantized
   span a square grid uses, which is approximate on a hex.
3. **Multi-segment scale bars.** Several scale-bar drags averaged (weighted
   by length) instead of the single segment the calibration keeps.
4. **The wall sheet's road row at its default width.** At the sheet's 480 px
   the surface select cuts its *Not a road* label short; the row's three
   controls want a width each, or a second line.
5. **Worldographer import and export.** The owner's ruling of 2026-10-24
   (DECISIONS, "The map shows one mode at a time", Q6b): the map modes are
   built in Foundry, and a `.wxx`
   file is exchanged with them after. A file's hexes would be read into a hex
   scene's terrain regions and written back from them, through a table the
   Judge keeps from the file's tile names to the brush's terrain keys. The
   format is known only from an open converter (`mdhender/wxconv`): gzip over
   UTF-16 XML, unverified against a file of the user's own.
6. **The markets mode.** The owner's rulings of 2026-10-24 (DECISIONS, "The
   map shows one mode at a time", Q2a and Q3): every placed location with a
   market class (`marketClass`) reaches the hexes within its Range of Trade
   (JJ Ch6 Step 7E), measured along roads (`roadDistance`) and navigable
   water, never as a circle; each hex is coloured by the market reaching it
   and checkered outside every reach. The per-class reach figure is imported
   (markets MODEL, "Range of Trade"); no mode registers (`registerMapMode`)
   to draw it. The distances from a city that classify a new domain (RR
   §VIII.3) are a different reach and are not this mode.
7. **A hover card.** Every mode names, under the pointer, each key of
   `countryAt` and the source that answered it.
8. **Brush ergonomics.** A flood fill and brush sizes over several hexes
   (Hexographer's); the brush paints one hex at a time.
9. **Map setup's later batch.** Found by the map setup revision's audit and
   walks (2026-11-15/16) and left for a batch of their own; each is a row on
   the bug-intake ledger, by id. The Map setup window:
   - T-0623: the corner rows, the scale-bar row, the map-cell and output
     chips, the field placeholders, the clamped figure and the across/down
     inputs carry no tooltip.
   - T-0624: the window jumps to its top on every re-render (the body part
     keeps no scroll position).
   - T-0625: on a hex family the grid-size hint speaks of a Foundry square.
   - T-0626: the scale-only confirmation is titled as a grid calibration.
   - T-0628: "px" names image pixels on the card and the box rows, and canvas
     pixels in the grid-size fields and the measured scale.
   - T-0629: a sample row's delete button has no spoken name.
   The hex fit, each measured offline in Phase 1, re-measured on 2026-11-25
   and not fixed: T-0593 (after several boxes sharing one outline bias, a far
   box lands a hex short, on the row types as well as the column types);
   T-0594's two remaining parts (a lone box carries only its aspect, which a
   1.25x stretch shares with the other family squeezed; and flat columns
   stretched 1.25x on canvas, and in the image, fall outside the shape range
   `HEX_SHAPE_LEAN` allows, so no box is one hex), the second waiting on a
   ruling on that bound.
   The capture tools and the group:
   - T-0634: the corners hint promises rotation and skew without naming
     Allow skew.
   - T-0635: three names for removing: Wipe clears every sample unasked and
     has no hint, Eraser removes samples where the palette's Erase unpaints
     hexes, and the brush has no Escape.
   The brush, the wall layers and the navigation card: T-0601 (the
   palette's layer pills and the Map modes pills look alike and do different
   things), T-0603 (the alley preset's notice and the shore's names disagree; three
   road presets share one glyph), T-0604 (the road row has no spoken names,
   and its fields stay editable under "Not a road" and "Not water"), T-0605
   (swatches put world labels in `data-tooltip`), T-0606 (the opacity slider
   shows no figure and does nothing in Terrain mode), T-0607 (the picker's
   clearing entry and the Dungeon/Wilderness words against the party sheet's
   Delve/Journey).
10. **The battlemap tools on a scene owner's seat.** The battlemap scene control group (setup, capture, map
    modes, the Country brush, Apply), the scene card's declaration and the Scene config's row are the Judge's.
    Proposed: read the scene's ownership, the brush adding Foundry's Create Regions and the region's ownership,
    the bake keeping Upload Files. Open: Foundry draws its own scene-building controls on a Judge's seat only;
    read that way these already follow Foundry and the row closes unbuilt. 1 surface, 10 role reads.
