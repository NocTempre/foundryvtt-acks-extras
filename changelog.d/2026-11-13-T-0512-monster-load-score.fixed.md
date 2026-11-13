- **A monster's load state and blank attribute fields read the imported Monstrous Manual.** On a monster sheet's
  Inventory tab, the load bar's tooltip and the Encumbered label cite MM p. 13, the speed share beside "Carried" shows
  the imported figure and nothing where none is imported, and a creature with no Max Load of its own takes the imported
  multiple of its Normal Load; with neither, the bar scales to the larger load and never reads Overloaded. The Statblock
  tab's load note drops "max" when there is none. On the Classification tab, a blank attribute field shows the imported
  default score as its placeholder (MM p. 349) and none where it is not imported. Both figures arrive through the
  importer's monsters document (tables `loadRule` and `defaultScore`) and a Judge edits them in the Ruledata Browser
  (`Settings tab → Game Settings → ACKS II — Extras → Imported Rules Tables → Open Ruledata Browser`).
