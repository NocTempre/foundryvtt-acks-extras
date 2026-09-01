---
name: acks-bug-triage
description: Investigate and resolve bug reports against acks-extras (its importer subsystem included) through the persistent intake ledger — pull open GitHub issues or take pasted batches, dedupe against earlier batches and unshipped fixes, dispose each report as false report, docs gap, style feedback or code fix, and ship what broke. Use when the user submits a batch of bug reports, says "triage the bugs", asks to pull or check the GitHub issues, or reports a bug without designating a release kind.
---

The front door for bug reports. `acks-hotfix` turns symptoms into a patch and
`acks-release` ships it; this skill owns what those assume has already
happened — intake, dedupe against every earlier batch, the four-way
disposition (false report / docs gap / style feedback / code fix), and closing the loop with
the reporter. Reports arrive in overlapping batches from two directions
(pasted lists and the GitHub issue queues), and the hazards this skill exists
to prevent are the batch hazards: diagnosing a symptom an earlier batch
already fixed, two sessions colliding on the same repo, cutting two releases
where one bump covers both, and a reporter who never hears back.

Sibling skills, by scope: this → intake and disposition, `acks-hotfix` →
routing and diagnosis mechanics (its §1–§3 are used from here verbatim),
`acks-minor` → the tripwire obligations, `acks-release` → shipping.

## 1. Every report gets a ledger row before anything gets diagnosed

Two intake sources. Check **both** every run, even when the user pasted a
batch — an issue in the queue may be the same defect and should close with it.

- **Pasted batch.** The user's message. Label it `paste:<YYYY-MM-DD><letter>`
  (letter disambiguates same-day batches: `paste:2026-08-11a`). One symptom =
  one row; split compound bullets the way `acks-hotfix` §2 splits a field
  report, and keep the reporter's phrasing in `title` — it is the evidence of
  what they actually hit. A single report dropped into the session mid-work is
  a batch of one and takes the same path: row first, then diagnosis.
- **GitHub issues.** Both queues:

  ```bash
  gh issue list -R NocTempre/foundryvtt-acks-extras --state open --json number,title,createdAt,labels
  gh issue list -R NocTempre/foundryvtt-acks-importer --state open --json number,title,createdAt,labels
  ```

  `gh issue view <n> -R <repo> --json title,body,comments` for the ones you
  take. Source label is `gh:extras#12` / `gh:importer#3`. The importer repo is
  a read-only archive since the 2026-09-01 merge: anything still open there is
  worked as an extras fix (the code lives in `scripts/importer/`) and its row
  keeps the `gh:importer#n` label so the reporter can be found. An issue filed
  through the site's bug form arrives pre-structured (versions, steps,
  expected, console output) — read the whole body, reporters put the real bug
  in whichever box they liked. Two machine-filed labels are also intake:
  **`nightly-failure`** (the deterministic nightly run — see
  `.claude/rules/delegation.md`; one open issue per repo, close it when
  green) and **`local-triage`** (local-model verdicts; treat as unverified
  leads, never as diagnoses). **The repo an issue was filed against is a
  guess, not a routing.** Reporters file where the site's chooser sent them;
  route by symptom (`acks-hotfix` §1) and record your routing in `repo`,
  which may disagree with the issue's home. The fix lands where the routing
  says; the close-out comment lands where the issue lives.

Register every symptom as a row **before diagnosing any of them**. Intake is
cheap and global; diagnosis is expensive and blind to what it never heard
about.

## 2. The ledger

`C:\Proj\acks-rules\bug-intake\ledger.csv` — LOCAL-ONLY, the same posture as
`TEST_ENVIRONMENT.md` and the hygiene audit: it spans both repos, issue bodies
may quote licensed book text, and canon forbids a permanent in-repo artifact
of this kind. Never committed, never shipped, never quoted into a repo.

Columns: `id,opened,source,repo,title,status,fixed_in,dup_of,claim,notes`.
Ids are `T-0001` onward, stable forever, never reused; rows are never deleted
— the trail of what was once reported is the dedupe corpus. Keep `title` and
`notes` free of commas (use semicolons) so hand edits never break the quoting.

| Status | Meaning |
| --- | --- |
| `new` | registered, not yet claimed |
| `claimed` | a session is on it — `claim` says which |
| `fixed-unreleased` | fix committed on the repo's `main`, awaiting the consolidating release; `notes` carries the sha |
| `released` | shipped; `fixed_in` names the version |
| `docs-only` | resolved by documentation; `notes` names the doc that now says it |
| `false-report` | works as coded **and** as intended, with the evidence recorded |
| `style-feedback` | a preference, not a defect — collected, never adjudicated; the accumulated rows are the feedback corpus |
| `not-reproducible` | could not be made to happen — a different claim from `false-report`, never a synonym |
| `duplicate` | same defect as `dup_of`; resolves with it |
| `routed-elsewhere` | belongs to another family repo or upstream core; `notes` says where it went |
| `deferred` | real, but waiting on a designated minor/major; `notes` records the tripwire that forced the wait |

## 3. Dedupe and claims — the batch discipline

Three checks between intake and diagnosis, in order:

1. **Match against the ledger.** Every new row against every existing row,
   open *and* resolved — same subsystem, same surface, same misbehaviour. A
   match to `fixed-unreleased` or `released` is answered from the ledger:
   verify the reporter's version predates the fix (or that HEAD carries it)
   and close the new row as `duplicate`. A match to an open row joins it. Do
   not trust title similarity alone; read what the original row's fix
   actually changed before declaring the new report covered by it.
2. **Match against unledgered work.** `git status` and
   `git log v<last-tag>..HEAD --oneline` in each routed repo. A fix that is
   already on `main` but unshipped — from a standalone hotfix run, or work
   the ledger never heard about — means the row goes straight to
   `fixed-unreleased` and the consolidating release (§6) picks it up.
3. **Respect other sessions' claims.** A row `claimed` by a claim label that
   is not yours is in flight: skip it, report it as in-flight, and do not
   diagnose it "just to check". Then claim your own rows — set `status` to
   `claimed` and `claim` to `<date> <batch-label>` — **before** the fan-out
   starts. Re-read the ledger immediately before every write-back; another
   session may have appended rows, and your ids continue from the highest
   present, theirs included.

A claim from a session that plainly died (days old, no matching commits or
uncommitted work in the repo) may be taken over — say so in the report rather
than silently absorbing it.

## 4. Diagnose

Mechanics are `acks-hotfix` §1–§3, used as written: the two orientation reads
(`TEST_ENVIRONMENT.md`, the repo table), the rules-lookup order, the routing
table, the report-kind split, and the parallel Workflow fan-out with one
investigator per symptom plus the cross-check. Nothing there is repeated here.

The rules-lookup order (`.claude/rules/rules-lookup.md`) matters most in this
skill, because a **false report** and a **docs gap** both turn on what the
book says: snapshot first, then the local extracts and `DECISIONS.md`, a PDF
only for a gap or an explicit double-check.

**When to fan out** is decided by what survives §3, not by the batch's size
on arrival. Only rows that are unclaimed, non-duplicate, and carry *your*
claim get an investigator — a `duplicate` or in-flight row never earns one
"just to confirm". One or two surviving rows are diagnosed in-session (or by
a single agent) with the same prompt discipline and structured verdict; the
Workflow fan-out earns its overhead from about three symptoms up. The
**cross-check always runs**, whatever the count — shared causes and
other-instances-of-the-pattern are this pipeline's best output, and a
two-row batch can still share one cause with last week's fix. Division of
labour is fixed: investigators diagnose and edit nothing; intake, ledger
writes, `gh` calls, dedupe and the release stay in the main session — a
workflow script has no filesystem access, and the ledger has exactly one
writer at a time by design.

One extension: each investigator's verdict must support the **four-way
disposition**, not just confirmed/not-found. So beyond the hotfix schema,
require: `works_as_coded` verdicts to say whether the behaviour is also
*documented* (cite the guide/reference line, or state that no doc says it)
and whether the report contests the *behaviour* or the *taste* — broken
against intent is a defect, working as intended but wanted different is
style feedback — and `confirmed-defect` verdicts to flag any tripwire
(migration / new setting / new surface) the minimal fix would cross.

## 5. The four dispositions

### False report — works as coded and as intended

The claim carries an evidence obligation in both halves: the code path
(quoted, `file:line`) and the intent (the guide, `docs/<feature>/MODEL.md`,
`DECISIONS.md`, or a book citation). When live reproduction is feasible,
attempt it — "works as coded" read from source alone has been wrong in this
family before (`DialogV2` strips attributes; correct code behind a stripped
attribute is unreachable). If the intent is real but written down nowhere a
user could find, the report is not false — it is a **docs gap** that arrived
dressed as a bug, and it converts.

Even a genuine false report is a signal: the reporter looked and could not
tell. Ask once per false report whether a guide line would have prevented it,
and add the line when the answer is yes.

### Docs gap — the behaviour is right and the words are missing

The fix is prose, not code: a line in `docs/guides/<feature>.md` (staged onto
the site by its build), a correction in the reference pages' *source* (they
are generated — fix the registration text or `tools/pack-data.mjs`, never the
staged copy), or a `DECISIONS.md` entry when the ruling itself was never
recorded. The site redeploys on push to `main` — **a docs-only resolution
needs no version bump and no release.** Commit with a plain subject; the
family's release-voice subjects are for releases.

### Style difference — a preference, not a defect

The module does what it means to do, the record says so, and the reporter
wants it to mean something else — layout, wording, workflow taste. These are
neither right nor wrong and are **collected, never adjudicated**: record the
row as `style-feedback` with the preference stated in the reporter's own
terms, and change nothing. The ledger's `style-feedback` rows are the
standing feedback corpus; when several reporters independently land on the
same preference, say so in the report — whether it becomes a `ROADMAP.md`
line is the user's call, never the triage's. Guard the boundary in both
directions: a preference wrapped around a data-loss or defect clause is
diagnosed as a defect (`acks-hotfix` §2's design-complaint row), and a
defect must not be waved off as taste because fixing it is inconvenient.

### Code fix — something is actually broken

Fix it under `acks-hotfix` §4–§5 discipline (data loss outranks everything; a
destructive write gets a guard, not just a repair; generated `packs/_source`;
synced `tools/*.mjs`; offline green proves nothing).

**Release kind, standing designation (2026-08-11):** invoking this skill on a
bug report is the user's declaration that broken code ships when the fix is
done, as a **hotfix** by default. A fix that crosses one of `acks-minor` §1's
tripwires (migration, new setting, new user-facing surface) ships as a
**minor** instead, carrying that skill's obligations — name the tripwire in
one line and carry on; do not park the work to wait for a decision already
made. A major is never cut from this pipeline without the user saying
"major".

## 6. One release per repo, covering everything pending

The release is a **consolidation point, not a batch artifact**. Before
handing to `acks-release`, sweep the ledger for every `fixed-unreleased` row
in that repo — any batch, any session — and check
`git log v<last-tag>..HEAD` for fixes the ledger never heard about. The
release's changelog covers all of it; an unreleased commit missing from the
notes is this family's most common release defect. Never cut a second release
for a sibling batch when one bump covers both — the ledger is how two batches
share one version number.

Rows claimed but not yet fixed do not block the release; they ship in the
next one. The race worth guarding is two sessions bumping the same repo:
re-read the ledger and the git log immediately before touching
`module.json`, and if another session's fresh commits are on `main`, their
rows join your changelog.

After `acks-release` verifies the manifest, flip every swept row to
`released` with `fixed_in`. Not before — a release that dies mid-pipeline
must leave the ledger telling the truth.

## 7. Close the loop

Nothing resolves silently. Two audiences:

- **GitHub-sourced rows.** Comment and close, on the issue's home repo even
  when the fix landed elsewhere:

  ```bash
  gh issue close <n> -R NocTempre/<repo> --comment "..."
  ```

  The comment is plain second person, present tense, and says what now
  holds: a code fix names the version that carries it ("Fixed in v3.6.4 —
  ...") and waits until that version is actually published; a docs gap
  links the page that now says it; a false report explains the behaviour and
  cites where it is documented, without condescension — they read the code's
  behaviour correctly and the intent wrong, which is at least half our
  fault. A style difference thanks them and says the preference is recorded
  as design feedback — neither a promise nor a refusal — and the issue
  closes; the ledger holds it. `duplicate` closes pointing at the surviving
  issue when there is one, or names the version whose fix covers it.
- **Pasted batches.** The per-bullet report back, `acks-hotfix` §7 shape:
  what it was, what it turned out to be, what shipped and in which version —
  and for anything not resolved, its status by name. A bullet that fell off
  the list is a defect in the triage, not a rounding error.

Update the ledger last, after the comments and the report agree with it.

## 8. The intake surfaces

Reports reach the queue through one structured issue form —
`.github/ISSUE_TEMPLATE/bug_report.yml` in acks-extras, module-owned, with an
optional "which book" field for import problems — and the site's
[Report a bug](https://noctempre.github.io/foundryvtt-acks-extras/start/report-a-bug/)
page (`docs/site/src/content/docs/start/report-a-bug.md`), which points at
it. Both surfaces carry the family's IP rule — cite book and page, never paste
licensed text or attach scans — and if the form's fields change, the site
page's description of what a good report contains changes with them.
