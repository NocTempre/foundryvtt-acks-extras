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
   (DECISIONS, "The map shows one mode at a time", Q6b): the map modes are
   built in Foundry, and a `.wxx`
   file is exchanged with them after. A file's hexes would be read into a hex
   scene's terrain regions and written back from them, through a table the
   Judge keeps from the file's tile names to the brush's terrain keys. The
   format is known only from an open converter (`mdhender/wxconv`): gzip over
   UTF-16 XML, unverified against a file of the user's own.
7. **The markets mode.** The owner's rulings of 2026-10-24 (DECISIONS, "The
   map shows one mode at a time", Q2a and Q3): every placed location with a
   market class (`marketClass`) reaches the hexes within its Range of Trade
   (JJ Ch6 Step 7E), measured along roads (`roadDistance`) and navigable
   water, never as a circle; each hex is coloured by the market reaching it
   and checkered outside every reach. The reach is a per-class figure the
   importer does not yet write from the Judge's own copy; without it the
   mode says so. The distances from a city that classify a new domain (RR
   §VIII.3) are a different reach and are not this mode.
8. **A hover card.** Every mode names, under the pointer, each key of
   `countryAt` and the source that answered it.
9. **Brush ergonomics.** A flood fill and brush sizes over several hexes
   (Hexographer's); the brush paints one hex at a time.
