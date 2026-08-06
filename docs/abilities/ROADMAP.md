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

## Reordering throws

Throws present in the order they were added. An ability whose book prints them
in another order has to be retyped to match. Ordering is not stored, so this is
a field before it is a control.
