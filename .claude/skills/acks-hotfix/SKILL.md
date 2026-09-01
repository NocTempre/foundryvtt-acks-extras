---
name: acks-hotfix
description: Triage a field bug report against the ACKS module family and cut the resulting hotfix — route each symptom to the owning repo, diagnose symptoms in parallel, split patch from minor. Use when the user designates a hotfix — "bug report to hotfix", "ship this as a hotfix" — for symptoms already in hand. Batch intake, GitHub-issue pulls, and reports whose disposition is still open (may be a false report or a docs gap) enter through acks-bug-triage instead.
---

Turning a player's bug list into a shipped patch. The release mechanics are
**not** here — they are `acks-release` (kind = hotfix) and TOOLCHAIN §4. This
skill covers only what comes before that: orientation, routing, diagnosis and
scoping.

Reports that arrive as a batch, from the GitHub issue queues, or without a
release-kind designation go through `acks-bug-triage` first — it owns the
intake ledger (`C:\Proj\acks-rules\bug-intake\ledger.csv`) and calls back into
this skill's routing and diagnosis. A standalone run of this skill still
records each bullet's outcome as a ledger row when the ledger exists, so the
next batch can dedupe against what already shipped.

## 1. Orient before reading any module source

A field report names *symptoms*, not modules, and the family is many repos. Two
reads answer nearly every "where does this live" question — do them first, and
do not open a module's `scripts/` until they are done.

**a. `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.** Read it in full even when you
do not think you will live-test. Besides defining this machine's server (and
the live gate `acks-release` will demand) it names the **runtime APIs each
module exposes** — `acksImporter.connectBook()`, staged fixture paths, which
module's dialog auto-opens at launch. That is the fastest routing evidence
available, and it is how you learn a symptom belongs to a sibling repo before
spending a fan-out on the wrong one. LOCAL-ONLY: never commit or quote its
ports, world id, user names or paths into any repo, skill or commit message.
If the file is absent, this machine has no test server — say so, and expect to
ship without the live gate.

**b. `ls C:/Proj | grep -i acks`.** The repo set changes. What is there today:

| Repo | What it is |
| --- | --- |
| `foundryvtt-acks-core` | The ACKS II system (AutarchLLC fork). **Read-only reference — a module task never edits it.** |
| `foundryvtt-acks-extras` | The merged module (`acks-extras`). Subsystems under `scripts/`: `lib abilities classes equipment formation henchmen influence location markets monsters vehicles importer` — the last is book connection and content/table extraction (`cookbook/`, `register/`, `tools/importer/`). |
| `foundryvtt-acks-importer` | Retired 2026-09-01: a read-only archive. Its open issues are worked in extras. |
| `acks-module-template` | Toolchain source of truth; skills, rules and hooks are canonical here. |
| `acks-rules` | LOCAL-ONLY rules extracts + `TEST_ENVIRONMENT.md` + the intake ledger and hygiene audit. Never committed, never shipped. |
| `acks-reference` | LOCAL-ONLY reference library (book scans/extracts, `WIKI-SNAPSHOT`). |
| `acks-domains` | **Not part of this project.** A symptom routed here is `routed-elsewhere`, not a family fix. |
| `acks-divine-conduit` | Isolated one-off; untouched by family tooling. Fix only on explicit request. |
| `acksii-compendia` | Third-party stopgap compendia — not ours; a symptom here is not our bug. |
| `acks-git-backups` | Pre-purge bundles. Not a live repo. |

The template's `docs/TOOLCHAIN.md` §0 carries this same table as canon; it is
repeated here so orientation costs one read, not two. If the two ever disagree,
TOOLCHAIN is right and this table is the stale one.

### Looking a rule up

The moment a bullet turns on "what does the book actually say", follow
`.claude/rules/rules-lookup.md` — wiki snapshot first (it is a validation
oracle for table shape), then the local extracts and `DECISIONS.md`, a PDF
only for a gap. Cite book/chapter/section, never a snapshot path.

### Routing a symptom

| The report mentions | Repo |
| --- | --- |
| Linking/connecting books, importing content or tables, page-reference extraction, the launch "Getting Started" dialog | `acks-extras` — the importer subsystem (`scripts/importer/`) |
| Proficiencies, classes and class powers, weapons/armor/encumbrance, formations and marching order, henchmen/hirelings/morale, reactions and influence, locations/storage/markets, monster stat blocks, vehicles, party & group actors | `acks-extras` |
| Domains, downtime, hijinks, syndicates | out of scope (`acks-domains` is not part of this project) — record `routed-elsewhere` |
| Divine Conduit class mechanics | `acks-divine-conduit` — isolated one-off; only on explicit request |
| Base sheets, rolls or combat with our modules **disabled** | `acks-core` — reproduce with modules off before blaming it |

**One report routinely spans two repos.** Say so to the user early: it means two
hotfixes, two version bumps, two releases. Do not silently fix a sibling repo's
bug inside the repo you happen to be sitting in.

## 2. Split the report — a field report is not a bug list

Classify every bullet before diagnosing any. The kinds behave differently:

| Kind | Tell | What it earns |
| --- | --- | --- |
| **Data loss** | "the module overwrote / replaced / deleted my …" | **Outranks everything.** Triage first, ship first, even if the reporter buried it mid-list and sounds forgiving about it. |
| **Defect** | plain "X does not work" | Normal diagnosis. |
| **Already fixed?** | "seems like that was fixed with the update" | **Verify; do not accept.** A symptom that stopped reproducing usually means one of two paths got fixed. Read for the second path. |
| **Maybe intentional** | "though that might be intentional" | Answer from `docs/<feature>/DECISIONS.md` and `git log -S`. If deliberate but undocumented for users, the fix is a changelog/guide line, not code. |
| **Design complaint** | "I understand why it was done, but …" | Not a bug on its face — **read it twice for the bug hiding inside.** These often carry a data-loss report in the subordinate clause. |
| **Scale question** | "I don't know how it handles N of them" | Answer with counted evidence (awaits in a loop, per-member document reads), not reassurance. |
| **Deferred by the reporter** | "UI polishing comes later, but …" | Still diagnose it — the cause is often shared with a bullet they did *not* defer. Let them decide what ships. |

Restate the split back to the user before writing any code.

## 3. Diagnose in parallel

Symptoms are independent; investigating them serially wastes the session. Fan
out with the Workflow tool — **one investigator per symptom**, then one
cross-check.

Every investigator prompt carries: repo path, that `acks-core` is a read-only
reference, the `scripts/`–`templates/`–`styles/`–`lang/en.json` layout, and
this standing instruction:

> Diagnosis only, edit nothing. Grep broadly with several naming guesses, then
> **read whole files, not excerpts**. Trace the full path: template → app class
> (`DEFAULT_OPTIONS`, `PARTS`, `form.handler`, `actions`, `_prepareContext`,
> `_onRender`) → change/submit handler → the document write. Quote the code you
> rely on. Return one of: confirmed-defect (with `file:line`), works-as-coded,
> not-reproducible, not-found (list every search you ran). A confident wrong
> answer is worse than "I could not determine this".

Force structured output — status, root-cause summary, evidence as
`{file, line, quote, why}`, proposed minimal fix, `hotfix_safe`, risk,
confidence — so the cross-check gets data instead of prose.

The **cross-check** stage is where the value is, and it has two jobs beyond
reconciling:

1. **Find causes that span symptoms.** Several dead form fields, or several
   undersized windows, are usually one broken base class or one CSS rule. A
   single edit that closes three bullets is the best result available.
2. **Grep the whole module for other instances of each confirmed pattern.** The
   user reported what they hit. If one multi-select is broken, check every
   multi-select; if one editor is read-only, check every editor. Ship the ones
   they have not hit yet.

Recurring causes in this family, worth checking by name:

- **`DialogV2` silently deletes HTML attributes off its allowlist.** A string
  `content` goes through `cleanHTML` → `cleanNode`, which copies only allowlisted
  attributes and drops the rest without warning
  (`common/constants.mjs`; `multiple` and `accept` are permitted on `select` but
  **not** on `input`). A dialog can therefore render markup that does not match
  its own source, and correct, well-tested feature code behind it becomes
  unreachable. Escape hatch: pass an **attribute-less** `<div>` whose `innerHTML`
  is the markup — `DialogV2` treats an element as trusted and skips cleaning.
  Suspect this whenever a control behaves as though an attribute were absent.
- Foundry v14 `<multi-select>` read as a scalar, or a setting registered
  `type: String` that silently collapses an array.
- `DialogV2.prompt`/`.confirm` default to `width: 400`, `height: "auto"` and
  **`resizable: false`** — a dialog that grows with its content clips its own
  footer and offers no handle to recover it.
- ApplicationV2 `position: {height: "auto"}` around an inner `overflow` region —
  collapses, putting the footer below the fold.
- A flex column whose scrollable child lacks `min-height: 0` — content clips
  instead of scrolling, and resizing does not help. Core's `.application
  .window-content` is `overflow: hidden` and outranks `.scrollable` on
  specificity, so adding that class alone does not fix it.
- Fixed `max-height` in px on a list inside a resizable window — dragging the
  window larger adds dead space instead of showing more rows. Want
  `flex: 1 1 auto; min-height: …`.
- Markup using AppV1's `.notes` class inside an ApplicationV2 dialog: core styles
  it only under `body.game .app`, and a `DialogV2` root is `.application`, never
  `.app`. The text renders ~45% taller than designed. The v14 class is `.hint`.
- A form PART rendered outside the `<form>`, so its inputs never submit.
- A field `name=` that is not a real schema path — the write is dropped in
  silence.
- Two decrement/apply paths for one action (a hook *and* a lib-wrapper wrap, or
  a wrap registered in both `init` and `ready`) — the classic double-spend.
- Unconditional writes to `system.description` that destroy user-authored text.

## 4. Scope: patch or minor

**The release kind is the user's designation, not yours to derive.** Invoking
this skill *is* the declaration that this ships as a hotfix — it is how the user
says how much release pipeline they want to spend, and the module's `CLAUDE.md`
says the same thing ("declared by the user, never derived"). Recommend freely
and say why; then do what they chose. Do not reclassify the work as a minor, do
not stop short of shipping to wait for a decision that has already been made,
and do not route to `acks-minor` unless the user asks for that.

The shape below is a **recommendation heuristic**, and the reason to voice it is
that a bigger release kind buys more gates. A **hotfix** classically restores
intended behaviour and carries no data migration, no new setting, and no new
user-facing surface. When the work in hand needs one of those, say so in one
line — "this adds a setting, which usually wants a minor; shipping as the hotfix
you asked for" — and carry on. The one thing to raise louder than a line is a
**data migration**, because that is the case where the kind changes what a world
has to survive, not merely how much ceremony surrounds it.

If the user does want it split, `acks-minor` is the subject; hand the deferred
bullets over with the tripwire that forced each one recorded alongside.

Two judgements this family has already made:

- **Losing user data is always in scope**, however large the fix. Add the guard
  in the patch even when the nicer version waits for the minor.
- **A destructive write gets a guard, not just a repair.** Fixing the write that
  overwrote a description does not help the players whose text is already gone —
  say plainly whether recovery is possible, and do not imply it is if it is not.

## 5. Repo rules that bite during a hotfix

Reflexes that are wrong here (full statements in the module's `CLAUDE.md`):

- `packs/_source/` is **generated**. Edit `tools/pack-data.mjs`; a direct edit is
  undone by the next `build:packs`. Compiled `packs/` is gitignored — there is no
  pack churn to discard.
- `tools/build-packs.mjs` and `tools/validate.mjs` are **synced** from this
  template. Fix the template and run `acks-sync-toolchain`; never hand-edit.
- One owner per wrapped core method. Overrides of core logic default to the
  shared `lib` subsystem, not to a feature.
- Green offline proves nothing — `validate`/`npm test` run against mocked
  globals, and the live gate is not optional. Procedure and the
  world-shutdown-before-build rule: `.claude/rules/live-testing.md`.

## 6. Ship it

Hand off to **`acks-release`** with kind = **hotfix**. It owns the version bump,
the live gate, tagging, CI polling and manifest verification; none of that is
repeated here. A hotfix captures no release snapshots unless the fix is
UI-visible *and* the user asks.

### Voice

Changelog and commit subject are written in the family's own register, and it is
easy to get wrong. The subject is a lowercase clause naming the restored rule —
not a ticket, not a component tag:

```
Hotfix 1.3.2 — a stand-in power is claimed by the box it fills, and named once
Hotfix 1.3.1 — an ability counts once per page, not once per source
Hotfix 1.2.1 — capacity belongs to gear, not to containers
```

Each `### Fixed` entry opens with a **bold sentence stating the rule as it now
holds**, then plain prose: what the player saw, what happens instead, and what
deliberately did not change. Present tense. No dates, no attribution, no issue
numbers, no "fixed a bug where".

> - **A proficiency is worth what the page says, once.** A character with
>   Diplomacy opened the influence roller at +2 … Each ability now speaks once
>   per page — through the checkbox that page offers — while an ability the page
>   has no checkbox for still brings a row of its own.

Describe the behaviour a player can see. The mechanism belongs in the code
comment; the ruling belongs in `docs/<feature>/DECISIONS.md`.

## 7. Report back

Per bullet in the original report: what it was, which repo owned it, what was
wrong, what shipped — and for anything not shipped, whether it was deferred to a
minor, judged working-as-designed, or could not be reproduced. A bullet you
never resolved is a result too; name it rather than letting it fall off the list.
