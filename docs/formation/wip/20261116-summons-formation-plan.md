# Summons march in their summoner's party — plan

Work in progress (docs-doctrine wip lifecycle): deleted once the work lands,
its substance moved into formation and character-sheet MODEL / DECISIONS /
TESTING.

## Owner ruling (verbatim, 2026-11-16)

Report: "Minor UI bug, summons and party formation conflict on the sheet. I
propose a new button for casting that includes summons management. Then you
can see them in you henchmen management when not in a party as currently, but
when in a party they get added to the full formation."

Asked whether summons become real formation members (token stashed into the
party, march in the order, deploy with it) or are shown and counted while
staying on the map: "Real members".

Example: a caster inside a party token casts a summoning for 2 wolves; both
wolves go into the party token, march in its order, come out with it on deploy
or detach, and go back in on recall.

The UI half (a caster column on the character sheet's right rail whose top
cell opens a Cast menu holding all summon management) is `topic/cast-cell`,
built separately.

## Owner answers (2026-11-16, verbatim)

- **Q1.** A summon at 0 hp inside the party — casualty, or not a person?
  "Not a person, removed/destroyed." So `isPerson` is false for a summon
  member, it never stops the column or needs carrying, and reaching 0 hp ends
  it: the member record (and any deployed token) goes, as a dismissal does.
  This adds a slice-4 trigger (a summon member's hp reaching 0, stashed or
  deployed) and a walk step.
- **Q2.** A creature bound to a character by hand — does it join? "What is
  bind? Sounds like a legacy shortcut ready to retire." Bind (2026-09-03)
  marks controlled canvas tokens as a character's summons; it predates the
  spell-driven summoning of 2026-11-10/11. Retired in `topic/cast-cell`:
  the Cast menu carries no Bind. Hand-bound creatures carry no cast record,
  so they never join a party.

## Blockers found (architect, verified in source)

1. **Identity.** Summons are unlinked tokens of one GM-made world copy per
   creature. `addMember` refuses a second member with the same `actorId`;
   `takeStoredDeployments` and `patchDeployments` key by `actorId` too, so two
   wolves overwrite each other's deployment; `addMember`'s fallback token
   search can stash another caster's wolf.
2. **Readers.** `summonsOf`, `summonsOnScene`, `castTokens` and
   `checkDismissRequest` scan scene tokens only, so a stashed summon is
   invisible to dismissal and expiry. Resurrection bug: `dismissOp` deletes a
   deployed summon's token, the member `deleteToken` hook leaves the record,
   and `recallMembers` restores the creature from its pre-deploy stash.
3. **Classification.** `getMemberActor` returns the world copy, so
   `summonerOf` reads false. XP is already right (`shareFor` treats an unhired
   monster as `notAPerson`). `isPerson` checks type only (Q1).
4. **Deploy/restore.** The stash is `toObject()` with its delta, so flags
   likely survive. Not seen live.

## Design

**Identity.** Each summon member gets its own minted `actorId`; a new
`baseActorId` names the world copy. Existing members need no migration.
`getMemberActor`, `memberStash`, `restoreMemberTokens` read
`baseActorId ?? actorId`; ~25 direct `game.actors.get(<member>.actorId)` sites
(repair-checks `deadMember`, scene-sync, turn-engine, trap-zone, turn-plan,
party-actor, player-requests, membership, formation-actions) go through
`getMemberActor`. A missed site reads "actor gone", which is already handled.

Rejected: shared `actorId` plus a side key (~230 comparisons in 39 files, a
miss acts on the wrong wolf); a lib group stack per cast (a sidebar actor per
cast, and a dismissed deployed body folds back in); a world actor per summon
(rejected 2026-11-10); gathering inside `recallMembers` (races
`removeMembers`); a member identity for every unlinked token (changes existing
parties — ROADMAP row).

**formation-model.** New `addSummonMembers(formationId, tokenDocs)`: one
`patchFormation` (blank cells first), then delete tokens, then
`syncPartyActorSpeed`. `addMember` routes a summon token there and refuses the
bare copy actor. `removeMembers` takes a summoner's summons out with them.

**Joining** — one `gatherSummons(formation, summonerIds)` on the GM client,
only when the summoner is a real, undeployed member, the party token is on the
summon's scene, and the summon carries a cast record; per-formation queue plus
per-token in-flight set.

| Event | Joins? | Trigger |
|---|---|---|
| Cast while formed up | yes | lib `placeOp` fires `acksExtras.summonsPlaced` |
| Cast while deployed | on the summoner's recall | end of combat-bridge `reform`, detach recall in deployment |
| Bind by hand | no (Q2) | — |
| Summoner joins later | yes | `acksExtras.memberJoined` |
| Summoner leaves | summons leave, restored | `removeMembers` |
| Disband | all restored | `dissolveFormation` |

**Readers** — through lib's `party-roster` service (lib imports no feature).
Service v2: member rows gain `summonedBy`/`summon` via a pure
`summonOfData(tokenData)` in summons-logic; new `memberOfToken(tokenDoc)` and
`release(partyId, ids)` (records first, then live tokens). Lib:
`heldSummonsOf(summoner)`, `castSummons(caster, castId)` → `{tokens, held}`,
`dismissSummons(summoner, {entries})`; the relay sends deployed-member tokens
and held records through `release`. Sheet: `summonsOnScene` adds held summons
whose party token is on that scene, entries `{tokenId|null, held|null, name,
img, record}` — fixes the party cell and `standingBySpell` at once;
`partyOf.membersOnScene` matches on `deployedSceneId`. Cast expiry:
`liveDeps.standing` and the end card's Dismiss use `castSummons`.

## Slices — `topic/summons-formation`

1. **Readers and dismiss** (implementer): `scripts/lib/summons-logic.mjs`,
   `summons.mjs`, lib tests, `docs/lib/{API,MODEL}.md`.
2. **Identity** (scout enumerates `game\.actors\.get\([^)]*actorId\)` and
   `getFormationForActor\(` fed a token's `actorId`; implementer applies):
   `formation-model.mjs`, `party-roster.mjs`, the listed sites, `snapshot.mjs`,
   the formation `deleteToken` hook (a summon member's token deleted by hand
   ends its membership), formation tests.
3. **Peers adopt** before slice 4: topic/cast-cell's Cast menu Dismiss passes
   `summonsOnScene` entries; topic/spell-effects adopts three points in
   `cast-expiry.mjs` (`castTokens`, `liveDeps.standing`, the card's Dismiss).
   Hand each requirement to its session.
4. **Joining** (implementer): `membership.mjs`, `combat-bridge.mjs`,
   `deployment.mjs`, formation `module.mjs`. Lands last, so `main` never holds
   summons nobody can dismiss or expire.

## Walk — new "Summons in the party" in docs/formation/TESTING.md

Reuse `summons/*` fixtures; add `summons/party`, `summons/party-token`,
`summons/summoner-b`, `summons/spell-named-b`. Player seat throughout.

1. Cast 2: no tokens on the scene; 2 members with distinct ids, each
   `tokenData.delta` keeps `summonedBy` and ownership; Magic tab shows 2.
2. Combat: deployed tokens carry the same delta flags, ownership, hp.
3. Hit-point tool on one stashed wolf: only that member's stash changes.
4. Caster B casts the same creature; A's Dismiss leaves B's two.
5. Delete one of B's deployed tokens by hand, recall: it stays gone.
6. Clock past the duration: end card shows the held count; its Dismiss
   empties it.
7. Caster leaves (summons restored with flags), rejoins (gathered).
8. Disband.
9. Drop the copy actor on the party: refused.

## DECISIONS drafts

**character-sheet/DECISIONS.md** — `## 2026-11-16 — A summon marches in its
summoner's party`. Asked: the owner's words above. New evidence: that ruling.
Ruled: a summon the module made joins its summoner's formation while the
summoner rides inside a party token on the summon's scene — at the cast, at
the summoner's joining, at the summoner's recall; it leaves with the
summoner; it ends when its token or member record goes; dismissal and a
cast's end reach it in either state; the party cell and Magic tab count it as
standing on its party's scene. Superseded in part: 2026-09-03 premise "A
formation's members are people in a marching order, not a summoner's
creatures" (the asterisk rejection stands); 2026-11-10 "goes when its token
goes"; 2026-11-11 what "stand on the scene" means. Cost: a Player acts on a
stashed summon only through Dismiss and the summoner's membership;
`tokenUuids` names deleted tokens once creatures join. Mark the three In-force
rows superseded in part.

**formation/DECISIONS.md** — `2026-11-16 — A summon is a member under a key of
its own`: the identity ruling and the rejected options above.

## Not verified

- Blocker 4 live.
- A join racing another session's whole-`members` write from a stale copy;
  the queue narrows it only.
- Whether the Player seat's placement completes before the stash.

## Results

(Phase sessions append here.)

### 2026-11-16 — phase session (orchestrator on topic/summons-formation)

**Slice 1, readers and dismiss** — implementer; landed bc9fa973. Lib
`summonOfData`, `heldSummonsOf`, `castSummons` → `{tokens, held}`,
`dismissSummons({entries, held})`; the relay routes held records and
deployed-member tokens through roster `release`, so lib never deletes a
member's token (the resurrection fix). Every v2 call is optional, so main
without a provider behaved as before. Offline: test-summons 50, test-magic 81,
test-lib 247, test-character-sheet 66, validate OK; three mutations went red.

**Slice 2, identity** — scout enumerated, implementer applied; landed
2b744904 (rebased over 079cb885, one import conflict in `sheet.mjs`, and over
c1057d38, both scenario blocks appended in `test-formation-flows.mjs`, kept
main's first). Minted `actorId` + `baseActorId`; `addSummonMembers`; the
roster provider v2 (`summonedBy`/`summon` rows, `memberOfToken`, `release`);
the member `game.actors.get` sites through `getMemberActor`; a summon's
deployed token deleted by hand ends its membership; `summonsOnScene` lists
held entries; the sheet's Dismiss paths pass `entries` (the cast-cell
requirement — its session ruled it into this slice, since cast-cell had
landed with nothing pending). Orchestrator added: a summon token joins only
its own summoner's party (`warn.summonerAbsent`). The recipe section
"Summons in the party" landed with it. Offline: test-formation-flows all
scenarios (6 summon scenarios), test-character-sheet 82, test-summons 50,
validate OK; five mutations went red (the release-ordering one fired on the
count, not the ordering assertion).

**Walks after slices 1–2, on main 2b744904** (`tools/live/run.mjs`, GM +
Player seats): character-sheet-summons passed 52/0, formation-membership
passed 38/0. magic-cast-summon errored twice (15/0, then 14/1) at "every click
point lies on the bare canvas": the Player seat's view had panned off the
scene (pointer at −618/−463, then −1718/−990) before the first placement
click, so the walk never reached slice code. It lacks the pointer-centring
step the character-sheet walk's drive mechanics record; a finding for that
walk's owner, not walked here. The new section's steps 1–9 need joining
(slice 4) and are not reachable yet; step 10 is held for the full walk after
slice 4.

**Slice 3, peers** — topic/cast-cell: done inside slice 2 (above).
topic/spell-effects: handed its three `cast-expiry.mjs` points (castSummons,
standing counts held, the card's Dismiss passes both) on 2026-11-16; its S2a
session scheduled them into its magic half. Slice 4 does not land until they
are on main.

**Slice 4, joining, with the docs and the walk** — implementer (joining),
orchestrator (DECISIONS, ROADMAP row 13, changelog fragment), implementer (walk
code); landed 8b0b1a3a, 91b631a4, 40f449e5 after the owner's pause. Two land
attempts were refused at the fast-forward by the dungeon close-out session's
in-flight `module.mjs` (S2, then S3; it held the four shared formation files
for the third attempt); the rebase onto 6cea4785 stopped in formation
DECISIONS, both appends kept, main's first. Gate green on 40f449e5.

**Walks on main 40f449e5** (`tools/live/run.mjs`, GM + Player seats):
formation-summons passed 101/0 on its third run; character-sheet-summons
passed 52/0 and formation-membership 38/0 on the first. The first two
formation-summons runs stopped at step 6's setup cast of three (56 pass): the
Player seat's warning was `badCount`, because the walk's fixture spell row
stated an amount of 2. The walk was at fault, not the module, which refused as
the row says; the fixture row now states 3, and a failed setup cast throws
with its counts and the seat's warnings. Exercised live: every step of the
recipe's "Summons in the party" from the Player seat, a recorder attached
before `init` on both seats with no error, and no console or uncaught error over
the walk. Ledger: kept `summons/party` (Actor.b9hu8TsmuPUP3AMQ) and
`summons/party-token` built this run, and reused the eight other `summons/*`
fixtures. The sweep removed only the run's own chat cards. Not checked: a
join racing another session's whole-`members` write; two GM seats at once.

**Left open from slice 4** (offline-noted, not walked): `gatherSummons` gates
on `isGM`, so with two GM clients connected both may gather (the per-client
claim set does not span clients); `recallMembers` re-stashes a summon at 0 hp
when its `updateActor` never fired; the 0-hp hook is not on
`acksExtras.lib`. magic-cast-summon still pans the Player view off the scene
before its first placement click (a finding for that walk's owner).
