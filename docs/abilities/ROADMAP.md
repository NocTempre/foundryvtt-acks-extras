# Abilities — not built

Work that is designed but absent, deliberately. How the feature behaves now is
[MODEL.md](MODEL.md); why it is shaped that way is [DECISIONS.md](DECISIONS.md).

---

## Shared level tables — the ladder half

The `progression` kind now resolves: the classes registry publishes every
class document's attack bands, `resolveLevelValue` completes lib's resolver
through them, and the roll editor's picker names the four chassis or any
class the world holds instead of retyping rungs.

What remains is naming a published LADDER (a thief-skill column, a house
table) rather than an attack progression — the registry publishes them
(`acks.class.<key>`), but the `progression` target's vocabulary only reaches
the attack table today. The internal table stays regardless — a throw whose
ladder is its own is the common case, and a shared table is an alternative
source for the same target, not a replacement for typing one.
- **Choosing a selection instead of typing one** — `selections` is free
  vocabulary by design (the token set is per-ability and lives in the book, so
  the schema cannot enumerate it), but the four abilities users meet most do
  have closed vocabularies in this repo already: fighting styles and Weapon
  Focus groups in `equipment/config.mjs` (`STYLE`, `WEAPON_FOCUS_GROUPS`,
  `WEAPON_CATEGORY`). Those could be offered as a select on the character's
  copy while the stored value stays a string, so nothing downstream changes.
  Reported from the field 2026-08-14 as "not selectable with enums".
- **An unresolved pick says nothing** — `abilities-bridge.mjs` resolves a
  Fighting Style Specialization pick through `resolveStylePick`, which knows
  five styles and returns null for anything else; the caller skips it. So a
  specialization whose selection the vocabulary does not recognise grants no
  bonus and reports no reason — the failure is invisible at every layer. The
  file is deliberately Foundry-free and logs nothing, so surfacing it means
  carrying unresolved picks out in the collector's return for a consumer to
  show, rather than warning from inside.
