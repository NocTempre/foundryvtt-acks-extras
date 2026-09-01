---
name: acks-hygiene-sweep
description: Audit foundryvtt-acks-extras (its importer subsystem included) against the standing code-hygiene checklist — typing, guards, silent failures, registrations, Foundry AppV2/v14 conventions, library reuse, i18n, theming, docs, doctrine and rules-vocabulary drift. Use when the user asks for a hygiene sweep or code audit of the acks modules, when accumulated changes want a health check, or as an optional step before a minor/major release.
---

A standing audit, not a one-off. It runs a fan-out of paired find/verify agents
over both module repos, then synthesizes a triage report and a tracked CSV.

Deliverables live in **`C:\Proj\acks-rules\hygiene-audit\`** — local-only, never
committed, same posture as `TEST_ENVIRONMENT.md` and the rules extracts. It is
outside both repos on purpose: the findings span both, and canon forbids a
permanent in-repo artifact named AUDIT/PLAN/PROPOSAL.

| File | What it is |
| --- | --- |
| `findings.csv` | every hit, with a `status` column **you** own (see Tracking) |
| `TRIAGE.md` | prioritized narrative, newest run replaces it |
| `coverage.csv` | one row per checklist category — hits, or "not checked this run" |
| `state.json` | per-repo swept sha — what the next delta run diffs from |
| `wiki-vocab.json` | cached rules vocabulary, so a delta run skips re-extraction |
| `run/sweep.run.mjs` | generated each plan: the workflow with the plan baked in |

## Lenses

`--lens <name>` runs one slice of the checklist. Repeat to union them; default
is `all`. `node plan-sweep.mjs --list-lenses` prints the current set.

| Lens | Covers |
| --- | --- |
| `all` | all 36 categories (default) |
| `quick` | 7 high-signal categories — routine check-in |
| `release` | 26 — everything that can produce a Critical or High; use before a release |
| `foundry` | AppV2/v14, settings scope, hooks, flags, library reuse, manifest, coupling |
| `ip` | licensed-content safety + rules-terminology fidelity |
| `documentation` | comments, docstrings, type annotations, stale text |
| `i18n` | display text bypassing the lang file |
| `theming` | light/dark correctness + cascade layers (**styles/templates clusters only**) |
| `correctness` `typing` `structure` `doctrine` | the remaining groups individually |

Lenses compose with the run modes: `--lens foundry` alone still delta-scopes to
changed clusters; add `--full` to sweep every cluster through that lens.

**A lens narrows what was checked, and that propagates — by design.** A skipped
category is reported as *not checked this run*, never as clean; a stale finding
in a category the lens skipped is carried forward untouched rather than being
marked `Resolved`; and a lens run **does not advance the delta baseline**, so
the next full sweep still re-examines everything. Narrowing is always printed.
Only `theming` narrows *clusters* (styles/templates), and unioning it with an
unrestricted lens correctly widens back to all clusters.

## Run it

1. **Plan the run.** This resolves clusters, the git delta and cached
   vocabulary, then writes a self-contained workflow script with that plan baked
   in — the workflow has no filesystem access, so every disk/git decision
   happens here.

   ```bash
   node "C:\Proj\acks-module-template\.claude\skills\acks-hygiene-sweep\plan-sweep.mjs"
   ```

   Flags: `--lens <name>` (repeatable — see Lenses), `--list-lenses`,
   `--full` (every cluster, ignore state), `--cluster E4` (repeatable),
   `--check` (ownership audit only — prints which files were auto-owned, then
   exits), `--state <dir>` (override the audit dir), `--model <tier>`
   (`sonnet` default | `haiku` | `opus` | `root`; standing owner instruction —
   sweep agents run on a cheap tier; `root` removes the override so agents
   inherit the calling session's model. Criticals found by a cheap tier are
   ALWAYS re-verified once at the root model — the workflow's Escalate phase —
   so a cheap sweep cannot mint a release-blocking Critical unreviewed).

   If the user asked for a themed audit ("check the Foundry conventions", "just
   the IP pass", "docs only"), map it to a lens rather than running everything.

   Default is **delta**: clusters whose files changed since `state.json`'s sha,
   plus uncommitted work. First run has no state, so it sweeps everything.

   Read the stderr summary — it ends with the line you need next:

   ```
   RUN: C:/Proj/acks-rules/hygiene-audit/run/sweep.run.mjs
   ```

   If it says nothing changed, stop and report that. No runnable script is
   written and there is nothing to sweep.

2. **Run the sweep** — pass that path, and **no `args`**:

   ```
   Workflow({ scriptPath: "C:/Proj/acks-rules/hygiene-audit/run/sweep.run.mjs" })
   ```

   **Never retype the plan JSON into `args`.** It is ~20 KB, and hand-copying it
   through a tool call is how a run dies on a mangled em dash or an object that
   arrives stringified — failing in a way that looks like a broken script. The
   generated file already contains it; a path cannot be mistranscribed. Equally,
   do not point `scriptPath` at `sweep.workflow.mjs`: that is the ungenerated
   template and it throws on purpose, telling you to run the generated copy.

   A full sweep is 30 clusters ≈ 67 agents and takes a while; a delta or lensed
   run is usually a handful. This is the one sanctioned large fan-out in this
   family — the size is the point, and it is why delta is the default.

   **Pre-flight first if you changed any of these scripts.** `dryrun.mjs`
   executes the generated file with stubbed agents — no tokens, seconds to run —
   and checks the invariants a broken edit would violate:

   ```bash
   node "C:\Proj\acks-module-template\.claude\skills\acks-hygiene-sweep\dryrun.mjs" "C:/Proj/acks-rules/hygiene-audit/run/sweep.run.mjs"
   ```

   It reports the agent count per phase, the return-value shape, and fails if a
   not-checked category is marked clean, if checked+skipped ≠ 36, if a row
   carries a category outside the lens, or if the summary disagrees with the
   rows. Spending 67 real agents to discover a typo is the thing to avoid.

3. **Write the deliverables.** Save the workflow's return value to a scratch
   `.json`, then:

   ```bash
   node "C:\Proj\acks-module-template\.claude\skills\acks-hygiene-sweep\write-report.mjs" <result.json>
   ```

   It merges into the existing CSV (never clobbers it), round-trip-verifies its
   own quoting, and advances `state.json` — marking a repo `partial` when only
   some of its clusters ran, so the next delta cannot silently skip the gap.

4. **Spot-check before reporting.** Re-read 5–10 cited `file:line`s yourself,
   spread across clusters and severities, and include at least one finding from
   a category you would not have predicted. The verify pass is good, not
   infallible; a wrong line number in a tracked CSV outlives the session.
   Say in your summary how many you checked and whether any failed.

5. **Report.** Headline counts, the Critical/High list, and what is newly
   `Resolved`. Name any cluster that returned nothing — those files are
   unverified this run, and an unmentioned gap reads as a clean bill.

## Tracking

`findings.csv`'s `status` is yours to edit; the tool respects it.

| Status | Set by | Meaning |
| --- | --- | --- |
| `New` | tool | not yet triaged |
| `Fixed` | **you** | you fixed it |
| `WontFix` / `Deferred` | **you** | deliberate; survives re-detection untouched |
| `Resolved` | tool | re-audited (cluster ran, category in lens) and no longer reproduces |
| `Reopened` | tool | you marked it `Fixed` but it still reproduces — the fix did not take |

Rows are never deleted (the trail of what was once flagged is the value) and
ids are stable forever. A row carries over verbatim when its cluster was not
re-audited **or** its category was outside the lens — no evidence either way is
not evidence of a fix.

## The checklist is permanent

36 categories in six groups, in `categories.json` — the single source of truth.
`plan-sweep.mjs` resolves a lens against it and passes the selected groups to
the workflow, which generates its prompt text, its schema enum and its coverage
table from what it receives. One edit there reaches every consumer.

**Never prune a category because the code is currently clean.** A pitfall that
is fine today is exactly the one that gets missed when it appears later, so
`TRIAGE.md` opens with a coverage table where a zero-hit *checked* category
reads *confirmed clean* — a result, not an omission — and a category outside the
lens reads *not checked this run*, which is a different claim. Those counts are
computed in code, never authored by an agent, so a category cannot quietly
vanish from a report. This is canon from two directions: the user's standing
instruction, and DECISIONS 2026-08-04 — *a shared check must report what it
checked*, written after `npm run validate` went green having verified zero i18n
keys.

The same rule applies one level up, to files — and it is enforced by
construction, not by a warning. File discovery asks git (`ls-files` plus
untracked-but-not-ignored; `.gitignore` is the filter), so every `.mjs`/`.hbs`/
`.css` git can see is in scope. `clusters.json` is a **grouping hint, not an
allowlist**: a file no cluster lists is auto-assigned to the cluster owning its
nearest directory, or to a per-repo catch-all (`E0`/`I0`), and swept this run —
new files can never silently fall out of audit. The plan output names every
auto-owned file; adopt recurring ones into `clusters.json` for stable grouping,
but nothing breaks if you don't. Deliberate exclusions (both committed, so
invisible to `.gitignore`): vendored pdf.js (not ours to audit —
`vendor/acks-design/*.css` stays in scope because those tokens are the
family's own) and `.claude/` hooks (template-synced canon, audited at source).

## Adding a category or lens

Add the category to the right group in `categories.json` with a description
concrete enough that an agent can tell a real hit from a false positive — the
schema enum, the prompts, the coverage table and `coverage.csv` all derive from
that one edit. A new lens is an entry under `lenses`: `groups` pulls in whole
groups by slug, `categories` adds individual ones, and an optional `surfaces`
narrows which clusters run (omit it unless the categories genuinely cannot
appear elsewhere — over-narrowing silently loses findings).

Where a category needs background an agent cannot infer, extend the matching
context block in `sweep.workflow.mjs` (`DOCTRINE_CONTEXT`, `CORE_FLAW_CONTEXT`,
`THEMING_CONTEXT`, `APPV2_CONTEXT`, `LIBRARY_CONTEXT`) instead of inflating the
category description.

State known-clean baselines and deliberate designs in those blocks too. Both
modules are currently free of legacy AppV1 patterns, and `scripts/lib/sockets.mjs`
uses `game.socket` directly **on purpose** as a socketlib-absent fallback — the
context blocks say so, which is what stops thirty agents re-flagging the same
false positive.

## Scope

- **Audited:** `scripts/`, `tools/`, `templates/`, `styles/`,
  `vendor/acks-design/` in both repos.
- **Reference only, never edited:** `C:\Proj\foundryvtt-acks-core`. It is
  checked so the sweep can tell whether these modules inherited its known flaw
  patterns; a finding against core itself is out of scope.
- **Not audited:** the importer's `register/`/`cookbook/` JSON (data, not code)
  and vendored pdf.js.
- **Rules vocabulary** comes from `C:\Proj\acks-reference\WIKI-SNAPSHOT\*/md/` —
  all three core books (`rules/` = **RR**, `judges/` = **JJ**, `monsters/` =
  **MM**) as greppable markdown that keeps the table cells, row boundaries and
  paragraph breaks PDF extraction collapses into run-ons. That structure is why
  the snapshot is the sweep's **validation oracle** for closed sets and table
  shapes, and why no step here opens a PDF. Naming individual rule terms, enum
  values and chapter citations in findings is fine; verbatim extended prose or a
  whole arranged stat block is not.
