---
name: acks-minor
description: Scope and prepare a fix-driven minor release of an ACKS module — a small-fixes release that crosses the hotfix line because it carries a migration, a new setting, or a new user-facing surface. Use when a hotfix triage deferred bullets to a minor, when accumulated fixes are ready to ship, or when the user says a fix "can't be a hotfix".
---

The release that is mostly fixes but cannot be a patch. `acks-hotfix` ends by
kicking exactly this work out — anything needing a data migration, a new
setting, or a new user-facing surface — and this skill is where it lands.

The release **mechanics are not here**: version bump, live gate, tagging, CI
polling and manifest verification are `acks-release` (kind = **minor**) and
TOOLCHAIN §4. This skill covers scoping, the three obligations that force the
bump, and the snapshot cost that makes a minor different from a hotfix.

Sibling skills, by scope: `acks-hotfix` → patch, this → minor, `acks-release` →
all three.

## 1. Confirm it is actually a minor

**The user declares the kind, and their declaration is final.** CLAUDE.md is
explicit — a release is a major, minor or hotfix "declared by the user, never
derived". If they said hotfix, it is a hotfix; ship it as one. Say once, in a
clause, that it carries a migration or a surface, then do as they asked and do
not raise it again. Re-deriving the kind from the diff after the user has named
it is the single most annoying failure mode of these three skills: it reads as
arguing, it costs a round trip every time, and it is wrong — the tripwires below
are how to CLASSIFY a release nobody has classified yet, not a veto over someone
who has.

The same goes for the obligations. A minor's snapshots and the go-live gate are
this repo's standing rules and worth naming when they have not been met — once,
factually, in the report. They are not grounds for refusing to cut what was
asked for.

When the user has NOT named a kind, a hotfix restores intended behaviour and
nothing else, and exactly three things push a release over that line — name
which one, out loud, before starting:

| Tripwire | Why it would not otherwise be a patch |
| --- | --- |
| **Data migration** | A world's stored documents change shape. A patch that rewrites user data is not a repair. |
| **New setting** | The module gains a knob it did not have; worlds upgrade into a choice. |
| **New user-facing surface** | A button, dialog, tab or column that was not there. It needs a shot and a guide. |

If none of the three applies and nobody has said otherwise, this is a hotfix —
stop and use `acks-hotfix`. A release does not become a minor because there are
*many* fixes, or because the diff is large. The size of the diff never sets the
kind (TOOLCHAIN §4); one crossed tripwire does, absent a declaration.

**A major is still only ever explicit.** Nothing here promotes itself.

### Do not let it become a feature release

The characteristic failure of a fix-driven minor is drift: the bump is happening
anyway, so a half-built feature gets waved in. That release then ships a feature
gated by nobody's decision and shot by nobody's camera. The rule is the same one
the hotfix uses in reverse — **the tripwire earns the bump, and nothing rides
along on it.** Anything else that wants in gets its own decision from the user,
by name.

Losing user data is the one thing always in scope, however large the fix, and
**a destructive write gets a guard, not just a repair** — fixing the write does
nothing for the players whose text is already gone. Say plainly whether recovery
is possible, and do not imply it is if it is not.

## 2. Assemble the release from the record, not from memory

Three sources, all of them read before proposing a list:

1. **`git log v<last-tag>..HEAD --oneline`.** Work already on the branch ships
   whether or not anyone remembers it. The changelog must cover it; an
   unreleased commit missing from the notes is the most common minor-release
   defect in this family.
2. **Bullets a previous `acks-hotfix` pass deferred**, with the reason recorded
   there — usually one of the three tripwires above.
3. **`docs/<feature>/ROADMAP.md` / `DECISIONS.md`** for anything the deferral
   promised to this version.

Restate the assembled list to the user and get the cut **before writing code or
touching `module.json`**. Include what you are proposing to leave out — a
deferral the user never saw is a decision you made for them.

**A minor states rules — in a changelog entry's bold opening sentence, and in
any migration heuristic that decides what old data meant.** Verify each one
before writing it, in `acks-hotfix` §1's order: grep
`C:\Proj\acks-reference\WIKI-SNAPSHOT\` first (`rules/` = RR, `judges/` = JJ,
`monsters/` = MM — greppable markdown that keeps the table cells, row
boundaries and paragraph breaks PDF extraction collapses into run-ons, which
is what lets it serve as a **validation oracle** for a grid's shape), then the
local extract and `DECISIONS.md`, and only then a PDF. Cite
book/chapter/section, never a snapshot path — the snapshot is LOCAL-ONLY and
never reaches a changelog.

## 3. Each tripwire brings its own obligation

### a. A migration

The family migrates through the DataModel, not through a startup sweep:
`static migrateData(source)` on the data class, with the rules split into a
Foundry-free `*-migrate.mjs` that unit-tests under plain Node. Working example:
`acks-extras` `scripts/location/data/location-migrate.mjs` and its seam in
`location-data.mjs`.

- **Migrate on load, not on a sweep.** `migrateData` runs before validation when
  the document is read, so an un-migrated world renders correctly on its first
  open rather than after someone remembers to run a tool.
- **Idempotent by construction.** A source already carrying the new shape — in
  any state, `null` included — is left alone. That is what makes it safe to run
  on every read instead of once behind a version flag.
- **A heuristic that decides whether old data "counts" gets tested at both
  answers.** `looksLikeAMarket` exists because a field sitting at its default
  proves nothing; only a different value does. Test the yes and the no, and say
  in the changelog which way an untouched world goes.
- **Never migrate as a side effect of unrelated work.** From the location
  module's own header: doing the market move as a side effect of the storage
  work "would put a migration between a player and their belongings." A
  migration is its own release-worthy decision, announced as one.
- **Verify against a world that actually holds the old data** (TOOLCHAIN §4a
  step 4). Recover the pre-upgrade shape from git — `git show <tag>:<path>` —
  and re-create it as world documents in the live session. Reasoning from
  "Foundry does not delete world documents" is a citation, not a verification.

### b. A new setting

- **The default preserves existing behaviour.** A world that upgrades and
  changes nothing until asked is the promise a minor makes.
- **It must gate something.** An inert toggle is a bug, not a placeholder — this
  family removed three dead overlay switches that had shipped for versions.
  Confirm the gate live, at both values.
- **World or client scope is a decision**, and it belongs in
  `docs/<feature>/DECISIONS.md` with its reason.
- It appears in the settings UI in the live session, under its real label from
  `lang/en.json` — not an untranslated key.

### c. A new user-facing surface

A surface is by definition visible, so it carries the snapshot obligation below
and earns a line in its feature's `docs/guides/<slug>.md`. If it is consumed by
a sibling repo, TOOLCHAIN §10e applies: the dependency half lands **first**, and
the symbol must exist in the other module's released tag, not merely its HEAD.

## 4. The snapshot obligation is the real cost

This is where a minor stops resembling a hotfix. A hotfix shoots nothing; a
minor shoots **one image per changelog entry with a user-visible surface**,
captured inside the same live session that satisfies the go-live gate (§4b).

Canon words that as "Added/Changed" because it assumes a feature-driven minor.
**In a fix-driven minor the same test applies to a `### Fixed` entry** — the
question is whether a user can see the difference, not which heading it sits
under. `acks-extras` v2.1.0 shot its refusal messages for exactly this reason.
An entry with no visible surface (an API change, an internal refactor) gets no
shot; record that in the report rather than staging a frame for it.

When a feature is re-shot, **two referrers move**: its `docs/GALLERY.md` row and
the inline embeds in its guide. Rows you did not re-shoot keep pointing at older
`v<X.Y.Z>/` directories — that staleness is the audit and is meant to be left
alone. Never rewrite a past release's snapshot directory.

## 5. Repo rules that bite

The reflexes in `acks-hotfix` §5 apply here unchanged — generated
`packs/_source`, synced `tools/*.mjs`, one owner per wrapped core method, offline
green proving nothing, and shutting the world down before `npm run build:packs`.
Two that bite harder on a minor than on a patch:

- A migration or a new setting is precisely the kind of change mocked globals
  cannot verify. The live gate is not optional and a minor has more to exercise
  through it than a hotfix does.
- Raise `compatibility.verified` only to a version you actually tested on
  (TOOLCHAIN §3). Intra-family `requires` minimums are development-tracking, not
  a contract — do not compute or bump them.

## 6. Ship it

Hand off to **`acks-release`** with kind = **minor**.

### Voice

Commit subject and changelog use the family register. A minor's subject is
`Release <X.Y.0> — ` followed by a lowercase clause naming what now holds; two
clauses joined by *and* when the release has two headlines. Never "Hotfix" for a
minor.

```
Release 2.1.0 — coin goes where the rest of your gear goes, and a vault can be asked for
Release 1.4.0 — a line as wide as the corridor, and a stack that marches as the men it holds
Release 1.2.0 — gear declares where it is worn
```

Sections are `### Fixed` / `### Added` / `### Changed` / `### Removed`. **Lead
with `### Fixed` when the release is fix-driven** — that is the honest ordering
and what v2.1.0 does. Each entry opens with a **bold sentence stating the rule as
it now holds**, then plain prose: what the player saw, what happens instead, and
what deliberately did not change. Present tense. No dates, no attribution, no
issue numbers, no "fixed a bug where".

An entry for a migration says what happens to a world that upgrades — including
which way untouched data goes — because that is the sentence the reader is
looking for.

Describe behaviour a player can see. The mechanism belongs in the code comment;
the ruling belongs in `docs/<feature>/DECISIONS.md`.

## 7. Report back

Per item on the assembled list: what it was, what shipped, and which shot covers
it. Then, explicitly:

- **which tripwire forced the minor** — the justification for the bump;
- for a migration, what pre-upgrade world you built and what it proved;
- what you deferred, and to what;
- any snapshot obligation you could not meet, with the reason.

An item that never resolved is a result too. Name it rather than letting it fall
off the list.
