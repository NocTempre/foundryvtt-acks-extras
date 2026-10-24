# Battlemap — roadmap

1. **Formation auto-squeeze.** The face-width seam (`effectiveFrontage()`)
   ships; the wall-probing squeeze that narrows it in tight passages is
   formation work — staged in `docs/formation/ROADMAP.md` §3.
2. **Hex token behaviour.** Hex OUTPUT ships (DECISIONS 2026-08-30): the family
   is chosen, one drawn hex is pitched to one Foundry hex, and the shift lands
   the drawn hex on a real one. What is not built is the token half of the
   2026-08-19 ruling — tokens that resize and auto-arrange to fill a hex as its
   occupancy changes, an optional fixed "slots-per-cell" override, and a
   show-all button. Until then a hex scene sizes tokens by the same quantized
   span a square grid uses, which is approximate on a hex.
3. **Multi-segment scale bars.** Several scale-bar drags averaged (weighted
   by length) instead of the single segment v1 keeps.
4. **Gallery row.** The feature area is new, so `docs/GALLERY.md` gains a row
   at the first release that ships a screenshot — the sync fails on a row
   whose PNG does not exist yet, so the row and the shot land together.
5. **The wall sheet's road row at its default width.** At the sheet's 480 px
   the surface select cuts its *Not a road* label short; the row's three
   controls want a width each, or a second line.
6. **Worldographer import and export.** The owner's ruling of 2026-10-24
   (map-layers audit, Q6b): the map modes are built in Foundry, and a `.wxx`
   file is exchanged with them after. A file's hexes would be read into a hex
   scene's terrain regions and written back from them, through a table the
   Judge keeps from the file's tile names to the brush's terrain keys. The
   format is known only from an open converter (`mdhender/wxconv`): gzip over
   UTF-16 XML, unverified against a file of the user's own.
