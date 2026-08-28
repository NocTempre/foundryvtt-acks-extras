# Vehicles — rulings

Append-only. A superseded entry stays, marked.

## 2026-08-14 — One sub-type, namespaced, rather than waiting for core

Core's [#154](https://github.com/AutarchLLC/foundryvtt-acks-core/issues/154)
asks for vehicle sheets and has been open and untouched since 2026-04. Shipping
`acks-extras.vehicle` NAMESPACED means core can still claim a bare `vehicle`
without a name fight; if it does, this becomes a migration rather than a
collision. Rejected: waiting (the feature is wanted now) and a bare `vehicle`
(takes a name that is not this module's to take).

## 2026-08-14 — Land and sea are one sub-type, not two

`system.kind` distinguishes them. Rejected: separate sub-types, which would
duplicate cargo, attachment, and the whole capacity path to express a
difference that is really about which fields are meaningful — and which the
bucket derivation already answers per vehicle.

## 2026-08-15 — What a hull weighs is a fraction of what hit it

RR ch. 7 scales damage by ATTACKER rather than by armour: a man-sized creature
cannot hurt a vessel at all, and a boarding party hacking at the deck is not
damaging the ship. Implemented as a share table keyed on attacker class rather
than as a damage-reduction number, because the rule is a multiplier and the
zero case must be a real zero — a reduction would let a big enough swing
through.

## 2026-08-15 — Crew loss and hull damage do not stack

The rule is explicit that the two speed penalties are not cumulative: whichever
is worse governs. `speedFactor()` therefore returns `min(crew, hull)` and NAMES
which one is in force, so a Judge does not patch a hull to fix a speed the
missing rowers were costing all along. `voyageDay()` divides the crew fraction
back out before applying it, because `seaSpeeds()` has already scaled by it and
applying it twice would square it.

## 2026-08-15 — A vessel's day is twelve hours and a party's is eight

Kept in separate modules that agree only on the HOUR. A single "miles per day"
field shared between them silently understates a ship by half, and the
round-the-clock rule makes it worse: sailing through the night doubles the day
without changing the speed. `compareToMarch()` exists so a caller that wants
both has one honest way to get them.

## 2026-08-15 — Buckets are derived per vehicle, never assumed per family

The owner's pitch was that a wagon pools cargo with passengers. RAW is richer
and the model follows RAW: the pooling is real, but the exchange rate is
PRINTED PER VEHICLE and is not linear (a small palanquin's first berth is 15
stone, its second 17½), and taking the second passenger can cost speed. So the
rate is read from the vehicle rather than fixed at the vessel's fifty-stone
berth, and non-linear vehicles express themselves through the existing speed
tiers rather than through a new mechanism.

The same section of RR ch. 4 gives ONE column three meanings — "the driver,
driver and warriors (for chariots), or the passengers (for howdahs)" — so the
complement carries what it MEANS. A sheet labelling all three "Crew" is wrong
on two vehicles in three.

## 2026-08-28 — The team has two halves: abstract rows, real attachments

The row model conflated two things: "2 heavy horses" a Judge states without
minting documents, and a REAL ox dragged into the traces (a row with a uuid).
Meanwhile the draft bucket read the attachment layer's `draft` role, which
nothing ever wrote — so it was always empty, and the two stores could not
agree. Ruled: a row without a uuid is the ABSTRACT complement and stays; a
real animal in harness is a `draft` ATTACHMENT on the animal itself, carrying
its corrected `kind`, and no row at all. `draftPullOf` (occupants.mjs) sums
both halves and is STATED to the arithmetic (`landSpeed(…, {pull})`), which
keeps `vehicle-speed.mjs` document-free. Rows still holding a uuid are
honoured on read and converted lazily on an owner's next sheet render —
except rows marked not-pulling, which stay rows: an attachment has no idle
state yet, and a lame horse must not silently resume pulling by being
converted. The storage ruling itself — attachment as the single carry model,
the mount facade, the forest guard, the cached index — is
`docs/lib/DECISIONS.md` (2026-08-28).

Rejected: attachments-only (the printed table does not ask a Judge to mint
four horse actors to say "wagon, four horses"); rows-only (a real animal's
own sheet is the truth of what it is, and a roster row is a second copy that
drifts).

## 2026-08-28 — Stations: typed counts are the unnamed complement; named add

The seat-by-seat panel needed one counting rule or three: `crew.roles[].aboard`
already meant "hands aboard", `cargo.passengers` meant "unnamed passengers",
and the team's rows meant "animals nobody minted documents for". Ruled: every
typed count is the UNNAMED complement and named attachments ADD to it — the
pattern the passengers bucket already had, extended to crew and team. The
crew table therefore loses its Aboard column (the stations panel's stepper
writes the same field), because two inputs writing one field from one form is
a submission corrupting itself. Named crew reach the speed arithmetic as
EFFECTIVE rows (`effectiveCrewRoles`, stated to `seaSpeeds`/`speedFactor`/
`voyageDay` the way the team's pull is stated to `landSpeed`), with officers
counting as sailors toward the complement per RR ch. 7. Rejected: named crew
as display-only (a named rower who does not row is decoration, and the sheet
would show a full bench on a becalmed galley); deriving the typed fields from
the named crew (the abstract crew is the common case forever — the typed
statement stays authoritative, and what the named would justify is shown
BESIDE it with provenance).

## 2026-08-28 — Station cells are chips, not follower cards

The plan said follower cards; the card is the printed quarter-page — ability
grid, attack line — and a galley seats dozens. A bench of cards is a page of
scrolling, which is the opposite of "at a glance". Ruled: occupants render as
compact chips (portrait, name, sub-line, the half-hand badge), one shared
partial for the vehicle sheet and the formation window, with the full card
one click away on the actor itself. Cost: the chip shows less; the half-hand
badge and the group's effective count carry the part the seat actually needs.

## 2026-08-28 — The drop dialog asks; a seat drop does not

Silent target-routing (hold = passenger, anywhere else = the traces) made a
dropped character a draft horse, and the guide had promised a choice the code
never offered. Ruled: an actor drop opens a routing dialog whose options ARE
the derived station groups, each stating its cost before anything is written
— and a drop on a SPECIFIC seat attaches directly, because the gesture
already said everything the dialog would ask. Another vehicle offers only
cargo (lashed on), and the chain guard's refusal is surfaced, not swallowed.

## 2026-08-28 — Weights are true; the printed rate prices the unnamed head

Verified against the printed page (RR p. 316, Sea Vessels §Cargo): crew
weight never counts against cargo; a passenger is carried as cargo at a
printed per-head rate; a below-deck marine occupies that same rate as cargo
SPACE; and the marines' weapons and armour are weighed for real (the
section's worked example multiplies real gear stone by headcount). The
owner ruled the model: **the printed per-head rate is the airline
passenger — an unnamed head, belongings included; a specific actor charges
its specific weight** (body, or bodies for a stack, plus what it actually
carries), never the rate, never a floor of it. This supersedes the shipped
`max(rate, true)` reading (4.4.0–4.28), which matched neither sentence.
Alongside it, the marines rule ships structurally: a NON-MOTIVE crew role's
gear is freight (`cargoGear` on the occupant, charged by the buckets); motive
crew and officers ride entirely free. **Stacks count every body they stand
for** — `bodyCount` threads through weights (`lib/capacity.mjs borneBy6`),
station counters, the effective crew, and draft pull, so twenty mercs as one
group actor are twenty hands, twenty bodies of mass, and one shared kit.

Rejected: rate-plus-true-gear (reads the 50 st as pure space; the owner's
airline reading folds belongings into the printed rate instead); keeping the
floor (never printed anywhere). Cost: a light traveller charges less than
the book's flat rate — the owner's table, the owner's margin. A stack's
qualification badge reads the GROUP actor's own ability items, so a hired
sailor gang earns its tick by carrying a Seafaring ability on the stack.

## 2026-08-28 — crew.means is schema, not a phantom read

`complementMeans()` had read `crew.means` since the buckets shipped, and the
schema never declared it — so the ruling above it (one column, three
meanings) could not actually be expressed, and every vehicle fell to its kind
default. The field is now a blank-allowed choice of the four readings, and
the sheet offers it with the effective default named in the blank option, so
an unlabelled howdah still reads as what it is: wrong loudly, correctable in
one select.
