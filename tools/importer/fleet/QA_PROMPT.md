# QA worker prompt — cookbook extraction audit (one page batch)

Filled per batch ({A}, {B}) and passed to a Sonnet subagent. The worker AUDITS
executor output quality for every cookbook entry in its range and files defect
reports + assist proposals. It fixes nothing directly.

---

You are auditing ACKS cookbook extraction quality for Monstrous Manual pages
**{A}-{B}**. Work only in `C:\Proj\foundryvtt-acks-extras`. The shipped pipeline compiled
these entries and structural verification passed — your job is CORRECTNESS:
finding the per-page peculiarities structure checks can't see.

## Tools (dev-only, LOCAL reference PDFs required — they exist on this machine)
- `node tools/importer/dump-entry.mjs --pages mm {A} {B} --no-art` — FULL raw executor
  output per entry (stats incl. `_raw.*`, attack segments, spoils, every
  description paragraph). Dump in ~10-page slices to keep output manageable.
- `HARVEST_NO_ART=1 node tools/importer/harvest-page.mjs mm <a> <b>` — structural report
  when something looks off.
- Deeper probes: a small node script importing `scripts/importer/extract.mjs`
  (`openBook`, `pageItems`) to inspect a page's raw runs (x/y/str).

## Defenses (immunities / resistances / susceptibilities)
These are NOT baked per creature. The executor scans each monster's OWN prose
(from the seat's book) against a shipped vocabulary — the damage-type keys plus
`register/_refs/defenseEffect.json` — and unions in the creature's TYPE-inherent
defenses (an ACKS type rule authored once on the type node, cited). Rules:
- Work from what ACKS PRINTS: the creature's own entry AND ACKS system rules
  (e.g. the MM creature-type definitions, which state type-wide immunities).
  You MAY apply an ACKS rule (cite book+page). You may NOT apply assumptions or
  anything from OUTSIDE ACKS (D&D tradition etc.). If neither the entry nor an
  ACKS rule states a defense, it does not exist for us.
- A type-wide rule ("all undead are immune to …") is authored ONCE on the type
  node in `_refs/creatureType.json` (with a `note` citing the page), never
  per creature. Only 4 MM types have inherent immunities (construct, undead,
  plant, ooze) — confirmed by reading each type's printed sentence.
- Your only defense job: when a page STATES a defense using an effect WORD not
  in the vocabulary, propose it as a `registerTokens` entry
  `{ "registry": "defenseEffect", "token": "<word>" }`.
- Never author which immunities a specific creature has.
- A genuinely UNIQUE defense the book describes in a sentence that no enum
  captures is out of scope for now (the "special defense" pointer mechanism is
  not built — see docs; do NOT flag it as GM-remembers). Only report such a
  case if you actually find one printed, with the ≤40-char evidence quote.

## Defect classes to hunt (per entry)
1. **Prose jumbles** — run-on words (missing spaces), hyphen artifacts,
   truncated descriptions (entry continues past its page), stat/table text
   bleeding into paragraphs, paragraphs split or merged wrongly.
2. **Stat damage** — empty or garbled values, a value containing the next
   row's text, real fields leaked into `_raw.*`, wrong parenSplit results.
3. **Attacks** — name null/"?", segment count wrong vs the printed routine,
   `quality` null where the MM prints colored damage icons.
4. **Spoils** — missing though the page prints a Spoils block, shifted
   placement, mangled component names/effects, dropped parens.
5. **Anchor/expect** — suspicious `expect.found`, description that clearly
   belongs to a different monster.

## Output contract (STRICT)
- Write ONE file: `register/_proposals/qa-p{A}-p{B}.json` — a JSON array of
  `{ "id", "page", "severity": "high|med|low", "defects": [ { "class", "note" } ],
     "assists": { … }?, "registerTokens": [ { "registry", "token" } ]? }`
  Only entries WITH findings. `note` is short; quote at most 40 chars of book
  text as evidence. Supported assists (compiler-honored): `anchor`, `statPage`,
  `spoilsPage`, `noSpoils`, `noArt`, `descStopHeading`, and `attacks` — a
  NORMALIZED routine string for a rare attack format the generic parser
  mishandles (e.g. `"1 (smash 2+) or 1 (throw 0+)"`); names/counts/throws come
  from it, damage still extracts live from the page. Prefer an `attacks` assist
  over reporting an attack-parse defect the parser can't fix generically.
- Touch NOTHING else: no edits to register entries, `_refs/**`, `cookbook/`,
  `scripts/importer/`, `tools/importer/`.
- Never transcribe prose into any file beyond 40-char evidence quotes.

## Final message back to the orchestrator
- Entries audited / clean / defective (counts per class);
- the 5 worst entries with one-line symptoms;
- any SYSTEMIC pattern you saw (same defect across many pages) — these drive
  compiler fixes rather than per-entry assists.
