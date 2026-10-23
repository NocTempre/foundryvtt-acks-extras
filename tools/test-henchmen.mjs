/**
 * Pure-data regression tests for the henchmen macro pack: prefixed
 * deterministic ids, so dropping or adding a macro never renumbers the
 * others and no world's imported copy is orphaned.
 *
 * Run: npm test
 */
import assert from "node:assert";

const { buildMacros, packs } = await import(new URL("./pack-data/henchmen.mjs", import.meta.url));

const macros = buildMacros();
assert.ok(macros.length > 0, "builder yields macros");
const ids = new Set();
for (const macro of macros) {
  assert.match(macro._id, /^acksHm[0-9a-f]{10}$/, `${macro.name}: prefixed deterministic id`);
  assert.strictEqual(macro._key, `!macros!${macro._id}`, `${macro.name}: pack key matches id`);
  assert.ok(!ids.has(macro._id), `${macro.name}: id is unique within the pack`);
  ids.add(macro._id);
}

assert.ok(packs && typeof packs === "object", "packs manifest exported");

// ---- an offer to a bulk row, answered head by head ----
// The outcome table is invented (its edges are nobody's book), so a pass
// proves the rule reads the table it is handed.
{
  const { outcomeFromTable, headsOffered, headAnswers, tallyOutcomes, splitBulkRow, takeFromRow } = await import(
    new URL("../scripts/henchmen/rules/bulk-offer.mjs", import.meta.url)
  );
  const TABLE = {
    outcomes: [
      { max: 4, effect: "refuseSlander" },
      { min: 5, max: 6, effect: "refuse" },
      { min: 7, max: 7, effect: "tryAgain" },
      { min: 8, max: 13, effect: "accept" },
      { min: 14, effect: "acceptElan" },
    ],
  };
  assert.strictEqual(outcomeFromTable(TABLE, 3, 3), "refuseSlander", "the bottom row takes a low total");
  assert.strictEqual(outcomeFromTable(TABLE, 7, 7), "tryAgain", "a total inside a row takes that row");
  assert.strictEqual(outcomeFromTable(TABLE, 12, 20), "acceptElan", "a total past the top takes the top row");
  assert.strictEqual(outcomeFromTable({ outcomes: [{ min: 5, effect: "x" }] }, 2, 1), "x", "a total under the first row's min takes the first row");
  const clamped = { ...TABLE, naturalClamps: { natural2: { noBetterThan: "refuse" }, natural12: { noWorseThan: "accept" } } };
  assert.strictEqual(outcomeFromTable(clamped, 2, 9), "refuse", "a natural 2 is held at its clamp");
  assert.strictEqual(outcomeFromTable(clamped, 12, 1), "accept", "a natural 12 is raised to its clamp");
  assert.strictEqual(outcomeFromTable({ outcomes: [] }, 7, 7), null, "an empty table answers nothing");

  assert.strictEqual(headsOffered(6, 40), 6, "an offer reaches the heads named");
  assert.strictEqual(headsOffered(99, 40), 40, "never more than the row holds");
  assert.strictEqual(headsOffered(0, 40), 1, "never fewer than one");
  assert.strictEqual(headsOffered("x", 40), 40, "an unreadable count is the whole row");

  const answers = headAnswers({ natural: 6, total: 9, outcome: "accept" }, [2, 11, 4], TABLE);
  assert.deepStrictEqual(
    answers.map((a) => [a.natural, a.total, a.outcome]),
    [[6, 9, "accept"], [2, 5, "refuse"], [11, 14, "acceptElan"], [4, 7, "tryAgain"]],
    "each further head keeps the first head's modifier and answers on its own natural"
  );
  assert.deepStrictEqual(tallyOutcomes(answers), { accept: 1, refuse: 1, acceptElan: 1, tryAgain: 1 }, "answers tally by outcome");
  assert.deepStrictEqual(tallyOutcomes(["accept", "nonsense", "accept"]), { accept: 2 }, "an unknown outcome is not counted");

  let n = 0;
  const newId = () => `new${++n}`;
  const row = { id: "row1", name: "Laborer", quantity: 40, status: "available", segment: "specialist:x", availableFromTime: 77, refusals: [{ employerUuid: "E0", time: 1, result: "refuse" }] };
  const split = splitBulkRow(row, { accept: 3, acceptElan: 1, refuse: 1, refuseSlander: 1 }, { employerUuid: "E1", time: 99, newId });
  assert.strictEqual(split.offered, 6, "six heads answered");
  assert.strictEqual(split.rows[0].id, "row1", "the heads not offered keep the row's id");
  assert.strictEqual(split.rows[0].quantity, 34, "and the row's count drops by the heads offered");
  assert.strictEqual(split.rows.reduce((s, r) => s + r.quantity, 0), 40, "no head is lost or invented");
  for (const r of split.rows) {
    assert.strictEqual(r.segment, "specialist:x", `${r.id}: keeps the segment`);
    assert.strictEqual(r.availableFromTime, 77, `${r.id}: keeps the arrival time the churn reads`);
  }
  const slanderRow = split.rows.find((r) => r.status === "slandered");
  assert.ok(slanderRow && slanderRow.quantity === 1, "the slanderer is a row of its own, marked slandered");
  assert.strictEqual(split.slandered, 1, "one head refused and slandered");
  const refused = split.rows.find((r) => r.refusals.some((x) => x.result === "refuse" && x.employerUuid === "E1"));
  assert.ok(refused && refused.refusals.length === 2, "a refusing group carries the row's earlier refusals and its own");
  assert.strictEqual(split.rows[0].refusals.length, 1, "the heads not offered record no new refusal");
  assert.deepStrictEqual(
    split.hires.map((h) => [h.quantity, h.elan]),
    [[3, false], [1, true]],
    "the accepting heads are hired as one group and the élan heads as another"
  );
  assert.ok(split.hires.every((h) => split.rows.find((r) => r.id === h.id)?.status === "available"), "the rows to hire are still available to the hire");
  const whole = splitBulkRow({ ...row, quantity: 2 }, { accept: 2 }, { employerUuid: "E1", time: 99, newId });
  assert.ok(!whole.rows.some((r) => r.id === "row1"), "an offer to every head leaves no remainder under the old id");
  assert.throws(() => splitBulkRow({ ...row, quantity: 2 }, { accept: 3 }, { employerUuid: "E1", time: 99, newId }), RangeError, "more answers than heads is refused");

  const part = takeFromRow({ id: "m1", quantity: 30, status: "available" }, 12, newId);
  assert.deepStrictEqual(
    part.rows.map((r) => [r.id === "m1", r.quantity, r.status]),
    [[true, 18, "available"], [false, 12, "hired"]],
    "a unit taken from a row leaves the rest on the market"
  );
  assert.deepStrictEqual(takeFromRow({ id: "m1", quantity: 30, status: "available" }, 30, newId).rows.map((r) => [r.id, r.status]), [["m1", "hired"]], "taking every head hires the row itself");
  assert.strictEqual(takeFromRow({ id: "m1", quantity: 30, status: "available" }, 0, newId).takenId, null, "taking none changes nothing");
}

// ---- the network's class step: the page's value or a Judge's effect, never a name's ----
{
  const { collectEffectModifiers, hasEffectFlag, unvaluedPowers } = await import(new URL("../scripts/henchmen/effects.mjs", import.meta.url));
  const power = (id, effects) => ({ id, type: "ability", name: "Mercantile Network", effects: [], flags: effects ? { "acks-extras": { extras: { effects } } } : {} });
  const named = { items: [power("n")], effects: [], appliedEffects: [] };
  assert.deepStrictEqual(collectEffectModifiers(named, "marketClass"), [], "a power held by name alone carries no value");
  assert.strictEqual(hasEffectFlag(named, "marketClass"), true, "but it is present");
  assert.deepStrictEqual(unvaluedPowers(named, "marketClass"), ["Mercantile Network"], "and is named as missing its value");
  const imported = { items: [power("i", [{ type: "modifier", target: "marketClass", value: { kind: "flat", flat: 7 }, condition: "in a known market" }])], effects: [], appliedEffects: [] };
  assert.deepStrictEqual(
    collectEffectModifiers(imported, "marketClass").map(({ value, situational, source }) => [value, situational, source]),
    [[7, true, "ability"]],
    "the located value is read, situational"
  );
  assert.deepStrictEqual(unvaluedPowers(imported, "marketClass"), [], "an imported power is not missing anything");
}

// ---- the other henchmen powers: the page's value or a Judge's effect, never a name's ----
// The figures below are authored for the test; none is a page's.
{
  const { collectEffectModifiers, sumEffectModifiers, hasEffectFlag, unvaluedPowers, unvaluedDialogModifiers } = await import(
    new URL("../scripts/henchmen/effects.mjs", import.meta.url)
  );
  const ability = (id, name, effects) => ({ id, type: "ability", name, effects: [], flags: effects ? { "acks-extras": { extras: { effects } } } : {} });
  const actor = (items, appliedEffects = []) => ({ items, effects: [], appliedEffects, system: { details: { level: 3 } } });
  const flat = (n) => ({ kind: "flat", flat: n });

  const named = actor([ability("l", "Leadership"), ability("b", "Blood of Kings"), ability("c", "Command")]);
  assert.strictEqual(sumEffectModifiers(named, "retainBonus"), 0, "a limit power held by name adds nothing");
  assert.deepStrictEqual(unvaluedPowers(named, "retainBonus"), ["Leadership", "Blood of Kings"], "and each is named as missing its value");
  assert.deepStrictEqual(unvaluedPowers(named, "baseLoyalty"), ["Blood of Kings"], "per domain");
  assert.deepStrictEqual(
    unvaluedDialogModifiers(named, "henchmanMorale").map(({ label, value, dynamicInitial, dynamicLocked }) => [label, value, dynamicInitial, dynamicLocked]),
    [["Command", 0, false, true]],
    "a roll shows the unvalued power as a locked, unticked row at no value"
  );

  const imported = actor([
    ability("l", "Leadership", [{ type: "modifier", target: "retainBonus", value: flat(5) }]),
    ability("f", "Familial Loyalty", [{ type: "modifier", target: "retainBonus", value: flat(3), condition: "a related henchman" }]),
  ]);
  assert.strictEqual(sumEffectModifiers(imported, "retainBonus"), 5, "a located value counts; a conditioned one is offered, not summed");
  assert.deepStrictEqual(unvaluedPowers(imported, "retainBonus"), [], "an imported power is not missing anything");

  const own = ability("o", "Leadership", [{ type: "modifier", target: "retainBonus", value: flat(5) }]);
  const judged = actor([own], [{ id: "ae", disabled: false, parent: { documentName: "Item", id: "o" }, flags: {}, changes: [{ key: "flags.acks-extras.retainBonus", type: "add", value: "9" }] }]);
  assert.strictEqual(sumEffectModifiers(judged, "retainBonus"), 9, "an item's own Active Effect stands in for its page value");

  const talker = actor([
    ability("d", "Diplomacy", [{ type: "modifier", target: "reaction", value: flat(4), tones: ["diplomacy"] }]),
    ability("m", "Mystic Aura", [{ type: "modifier", target: "reaction", value: flat(6), kickerAt: 11 }]),
    ability("b", "Beast Friendship", [{ type: "modifier", target: "reaction", value: flat(8), vsKinds: ["animal"] }]),
  ]);
  const hiring = collectEffectModifiers(talker, "hiring");
  assert.deepStrictEqual(
    hiring.map(({ label, value, situational, condition }) => [label, value, situational, condition]),
    [["Diplomacy", 4, true, "ACKS-INFLUENCE.tone.diplomacy"], ["Mystic Aura", 6, false, null], ["Beast Friendship", 8, true, "animal"]],
    "a hiring offer reads reaction modifiers; one limited to a tone or a kind of target is offered, never applied, and says what it waits on"
  );
  talker.items.pop();
  const draftAbility = (id, name, effects) => ({ ...ability(id, name), flags: { "acks-extras": { extras: { unaudited: true, effects } } } });
  const drafted = actor([
    draftAbility("v", "Command of Voice", [{ type: "modifier", target: "reaction", value: flat(5) }]),
    draftAbility("k", "Blood of Kings", [{ type: "modifier", target: "retainBonus", value: flat(2) }]),
  ]);
  assert.deepStrictEqual(
    collectEffectModifiers(drafted, "hiring").map(({ value, situational }) => [value, situational]),
    [[5, true]],
    "on a roll, a draft entry's value is offered unticked"
  );
  assert.strictEqual(sumEffectModifiers(drafted, "retainBonus"), 2, "a sum has no row to offer, and takes the located value");
  const reacted = actor(talker.items, [
    { id: "rx", disabled: false, parent: { documentName: "Item", id: "d" }, flags: {}, changes: [{ key: "flags.acks-extras.reaction", type: "add", value: "2" }] },
  ]);
  assert.deepStrictEqual(
    collectEffectModifiers(reacted, "hiring").map(({ label, value, source }) => [label, value, source]),
    [["acks-extras", 2, "influence-effect"], ["Mystic Aura", 6, "ability"]],
    "an item whose reaction effect speaks is not counted a second time from its page"
  );

  const dominating = actor([ability("u", "Utter Domination")]);
  assert.strictEqual(hasEffectFlag(dominating, "skipCalamityLoyalty"), true, "a power with no value is present by its name");
  assert.deepStrictEqual(unvaluedPowers(dominating, "skipCalamityLoyalty"), [], "and has no value to miss");

  const unread = actor([ability("g", "Military Genius"), ability("k", "Familiar Folkways")]);
  for (const domain of ["hiring", "henchmanMorale"]) {
    assert.deepStrictEqual(unvaluedPowers(unread, domain), [], `a name no page backs as a ${domain} power is not read`);
  }
}

// ---- the henchman limit: the imported base plus Charisma, or none ----
// The bases below are authored for the test; none is a page's. A `retain`
// on a fixture is a field core no longer derives, and is never read.
{
  const { getRetainBase, getRetainMax, retainGap } = await import(new URL("../scripts/henchmen/acks-adapter.mjs", import.meta.url));
  const leads = { id: "l", type: "ability", name: "Leadership", effects: [], flags: { "acks-extras": { extras: { effects: [{ type: "modifier", target: "retainBonus", value: { kind: "flat", flat: 2 } }] } } } };
  const employer = (cha, { bonus, items = [] } = {}) => ({
    items,
    effects: [],
    appliedEffects: [],
    system: { scores: cha ? { cha } : {} },
    getFlag: (scope, key) => (scope === "acks-extras" && key === "retainBonus" ? bonus : undefined),
  });
  const withBase = (limit, fn) => {
    const saved = globalThis.acksExtras;
    try {
      globalThis.acksExtras = { lib: { tables: { hasDoc: (doc) => doc === "wages" && limit !== undefined, getTable: (doc, id) => (id === "henchmanLimit" ? limit : null) } } };
      fn();
    } finally {
      globalThis.acksExtras = saved;
    }
  };
  withBase({ base: 9 }, () => {
    assert.strictEqual(getRetainBase(employer({ mod: 1 })), 10, "the imported base plus the Charisma modifier");
    assert.strictEqual(getRetainBase(employer({ mod: -2 })), 7, "a negative modifier subtracts");
    assert.strictEqual(getRetainBase(employer({ mod: 1, retain: 40 })), 10, "a retain field is not read");
    assert.strictEqual(getRetainMax(employer({ mod: 1 }, { bonus: 1, items: [leads] })), 13, "a power and the manual flag add to it");
    assert.strictEqual(getRetainMax(employer(null)), null, "an actor with no Charisma score has no limit");
    assert.strictEqual(getRetainMax({ system: {} }), null, "nor one with no scores at all");
    assert.strictEqual(getRetainBase(employer({ mod: "1" })), null, "a modifier that is not a number is no score");
    assert.strictEqual(retainGap(employer(null)), "charisma", "the gap is the actor's");
    assert.strictEqual(retainGap(employer({ mod: 0 })), null, "a figure leaves no gap");
  });
  withBase({ base: 0 }, () => {
    assert.strictEqual(getRetainBase(employer({ mod: 2 })), 2, "a zero base is a figure, not a gap");
  });
  for (const [limit, label] of [[undefined, "nothing imported"], [{}, "a table with no base"], [{ base: null }, "a blank base"], [{ base: 4.5 }, "a fractional base"], [{ base: -1 }, "a negative base"], [{ base: "9" }, "a base read as text"]]) {
    withBase(limit, () => {
      assert.strictEqual(getRetainBase(employer({ mod: 1 })), null, `${label} yields no figure`);
      assert.strictEqual(getRetainMax(employer({ mod: 1 }, { bonus: 3, items: [leads] })), null, `${label}: no limit, whatever the powers add`);
      assert.strictEqual(retainGap(employer({ mod: 1 })), "import", `${label}: the gap is the import`);
      assert.strictEqual(retainGap(employer(null)), "charisma", `${label}: an actor with no Charisma score names its own gap first`);
    });
  }

  // The recipe's key is the reader's, and the figure it reads is the one after
  // its anchor. Every word but the anchor is invented.
  const { extractTable } = await import(new URL("../scripts/importer/table-extract.mjs", import.meta.url));
  const { TABLE_RECIPES } = await import(new URL("../scripts/importer/table-recipes.mjs", import.meta.url));
  const recipe = TABLE_RECIPES.wages.tables.henchmanLimit;
  const page = (lines) => lines.map((str, i) => ({ x: 320, y: 100 + i * 12, str }));
  const read = extractTable(page(["A badger with 3 setts and 2 cousins", `${recipe.locate} 11 henchmen, give or take a badger.`]), recipe);
  withBase(read, () => {
    assert.strictEqual(getRetainBase(employer({ mod: 0 })), 11, "the reader takes what the recipe extracts");
  });
}

// ---- the employer-level cap: the imported ladder, the ruler's bound, an unread rung ----
// The ladder and every word but the recipe's anchor are invented.
{
  const { maxHenchmanLevel } = await import(new URL("../scripts/henchmen/rules/wages.mjs", import.meta.url));
  const { extractTable } = await import(new URL("../scripts/importer/table-extract.mjs", import.meta.url));
  const { TABLE_RECIPES } = await import(new URL("../scripts/importer/table-recipes.mjs", import.meta.url));
  const withCap = (table, fn) => {
    const saved = globalThis.acksExtras;
    try {
      globalThis.acksExtras = { lib: { tables: { hasDoc: (doc) => doc === "wages" && table !== undefined, getTable: (doc, id) => (id === "employerLevelCap" ? table : null) } } };
      fn();
    } finally {
      globalThis.acksExtras = saved;
    }
  };
  const recipe = TABLE_RECIPES.wages.tables.employerLevelCap;
  const anchor = recipe.values[0].find;
  const page = (lines) => lines.map((str, i) => ({ x: 320, y: 100 + i * 12, str }));
  // Superscript suffixes sort as words of their own, a rung-shaped sentence
  // before the ladder breaks its run, and a parenthesis after it holds a figure.
  const read = extractTable(page([
    "A 9 level badger can hire 3 level cousins.",
    "nd th st A 2 level badger can only hire 1 level cousins.",
    "A 3 or 4 level badger rd th can hire 1 or 2 level cousins.",
    "A 5 level badger th can hire cousins of up to 3 level.",
    "A 6 level or higher badger can hire cousins of up to 5 level, plus two cousin levels per badger level above 6.",
    "(Cousins above 5 level are rarely for hire, but 2 setts hold them.)",
    `${anchor[0].toUpperCase()}${anchor.slice(1)}, a warden badger can hire any cousin below.`,
  ]), recipe);
  assert.deepStrictEqual(read, { rungs: [
    { min: 2, max: 2, cap: 1 },
    { min: 3, max: 4, cap: 2 },
    { min: 5, max: 5, cap: 3 },
    { min: 6, max: null, cap: 5, perLevel: 2 },
  ] }, "the recipe reads the last unbroken ladder up to its open rung");
  const inline = extractTable(page([
    "A 2nd level badger can only hire 1st level cousins. A 3rd level or higher badger can hire cousins of up to 2nd level, plus one cousin level per badger level above 3rd.",
    `${anchor}.`,
  ]), recipe);
  assert.deepStrictEqual(inline.rungs, [{ min: 2, max: 2, cap: 1 }, { min: 3, max: null, cap: 2, perLevel: 1 }], "an ordinal printed inline is read the same");

  withCap(read, () => {
    assert.strictEqual(maxHenchmanLevel(2), 1, "a one-level rung");
    assert.strictEqual(maxHenchmanLevel(4), 2, "the top of a spanned rung");
    assert.strictEqual(maxHenchmanLevel(6), 5, "the open rung's floor");
    assert.strictEqual(maxHenchmanLevel(8), 9, "the open rung rises by its perLevel");
    assert.strictEqual(maxHenchmanLevel(1), null, "a level below the ladder has no rung");
    assert.strictEqual(maxHenchmanLevel(8, true), 7, "a domain ruler reads any level below their own");
    assert.strictEqual(maxHenchmanLevel(0, true), 0, "and never below zero");
  });
  withCap({ rungs: [{ min: 6, max: null, cap: 5 }] }, () => {
    assert.strictEqual(maxHenchmanLevel(6), 5, "an open rung with no rise answers at its floor");
    assert.strictEqual(maxHenchmanLevel(7), null, "and nowhere above it");
  });
  for (const [table, label] of [[undefined, "nothing imported"], [{}, "a table with no rungs"], [{ rungs: [{ min: "2", max: 2, cap: 1 }] }, "a rung read as text"]]) {
    withCap(table, () => {
      assert.strictEqual(maxHenchmanLevel(4), null, `${label}: no cap`);
      assert.strictEqual(maxHenchmanLevel(4, true), 3, `${label}: the ruler's bound still holds`);
    });
  }
}

// ---- what a network posting reaches, and what its holder's roll adds ----
{
  const { postingSegments, networkSupplement, henchmanLevels } = await import(new URL("../scripts/henchmen/rules/availability.mjs", import.meta.url));
  // The levels are the imported rows', and these rows are invented.
  const withRows = (rows, fn) => {
    const saved = globalThis.acksExtras;
    try {
      const table = rows === undefined ? null : { rows };
      globalThis.acksExtras = { lib: { tables: { hasDoc: (doc) => doc === "availability" && !!table, getTable: (doc, id) => (id === "henchmanAvailability" ? table : null) } } };
      fn();
    } finally {
      globalThis.acksExtras = saved;
    }
  };
  withRows([{ level: 6 }, { level: 1 }, { level: 3, __missing: true }, { level: "2" }, { level: 1 }, { level: -1 }], () => {
    assert.deepStrictEqual(henchmanLevels(), [1, 6], "the imported rows' whole levels, lowest first, once each, an unread row left out");
    assert.deepStrictEqual(postingSegments("henchman:*"), ["henchman:1", "henchman:6"], "the general henchman post reaches every listed level");
  });
  withRows(undefined, () => {
    assert.deepStrictEqual(henchmanLevels(), [], "nothing imported lists no level");
    assert.deepStrictEqual(postingSegments("henchman:*"), [], "and the general post reaches no segment");
  });
  assert.deepStrictEqual(postingSegments("specialist:x"), ["specialist:x"], "any other post reaches its own segment");
  assert.deepStrictEqual(postingSegments(""), [], "a directed search reaches no shared segment");
  assert.strictEqual(networkSupplement(9, 4), 5, "the holder gets what their roll finds beyond the town's");
  assert.strictEqual(networkSupplement(3, 4), 0, "a smaller roll leaves the holder the town's pool");
  assert.strictEqual(networkSupplement(undefined, 4), 0, "no roll adds nobody");
}

// ---- the hiring offer: one imported table for the hosted page, the throw and every further head ----
// The edges and figures are invented; what is pinned is the reading.
{
  const { hiringOutcomeTable, hiringOfferFrom, hiringOffer, hiringOfferComplete, HIRING_OFFER_DOC, HIRING_OFFER_TABLE } = await import(
    new URL("../scripts/henchmen/rules/hiring-offer.mjs", import.meta.url)
  );
  const { outcomeFromTable, headAnswers } = await import(new URL("../scripts/henchmen/rules/bulk-offer.mjs", import.meta.url));
  const BANDS = [{ min: null, max: 3 }, { min: 4, max: 4 }, { min: 5, max: 10 }, { min: 11, max: 15 }, { min: 16, max: null }];
  const table = hiringOutcomeTable(BANDS);
  assert.deepStrictEqual(
    table.outcomes,
    [
      { max: 3, effect: "refuseSlander" },
      { min: 4, max: 4, effect: "refuse" },
      { min: 5, max: 10, effect: "tryAgain" },
      { min: 11, max: 15, effect: "accept" },
      { min: 16, effect: "acceptElan" },
    ],
    "the imported column becomes the outcome table, worst first, open at both ends"
  );
  assert.strictEqual(outcomeFromTable(table, 6, 4), "refuse", "a total on a one-wide band takes it");
  assert.deepStrictEqual(headAnswers({ natural: 6, total: 9, outcome: "tryAgain" }, [10], table).map((a) => a.outcome), ["tryAgain", "accept"], "a further head answers from the same column");
  assert.strictEqual(hiringOutcomeTable(BANDS.slice(1)), null, "four bands where five outcomes are named is not this table");
  assert.strictEqual(hiringOutcomeTable([...BANDS.slice(0, 4), { min: null, max: null }]), null, "a band with no edge is not read");
  assert.strictEqual(hiringOutcomeTable(undefined), null, "no column, no table");

  const read = hiringOfferFrom({ bands: BANDS, refusalPenalty: -7, slanderPenalty: -3 });
  assert.deepStrictEqual([read.refusalPenalty, read.slanderPenalty], [-7, -3], "both per-count figures are read as printed");
  assert.strictEqual(hiringOfferComplete(read), true, "a full import can be rolled and priced");
  const partial = hiringOfferFrom({ bands: BANDS, refusalPenalty: "", slanderPenalty: -3 });
  assert.strictEqual(partial.refusalPenalty, null, "a blank figure is unread, never zero");
  assert.strictEqual(hiringOfferComplete(partial), false, "and the throw cannot be priced");
  assert.strictEqual(hiringOfferComplete(hiringOfferFrom(null)), false, "nothing imported is nothing to roll");

  const { EXTERNAL_MODES } = await import(new URL("../scripts/influence/constants.mjs", import.meta.url));
  assert.deepStrictEqual(
    [HIRING_OFFER_DOC, HIRING_OFFER_TABLE],
    [EXTERNAL_MODES.hiring.printedDoc, EXTERNAL_MODES.hiring.printed],
    "the throw reads the table the hosted page reads"
  );
  const saved = globalThis.acksExtras;
  try {
    globalThis.acksExtras = { lib: { tables: { hasDoc: (doc) => doc === HIRING_OFFER_DOC, getTable: (doc, id) => (id === HIRING_OFFER_TABLE ? { bands: BANDS, refusalPenalty: -7, slanderPenalty: -3 } : null) } } };
    assert.strictEqual(hiringOffer().slanderPenalty, -3, "the world's import is read from the influence document");
    globalThis.acksExtras = { lib: { tables: { hasDoc: () => false } } };
    assert.deepStrictEqual(hiringOffer(), { outcomes: null, refusalPenalty: null, slanderPenalty: null }, "a world without it reads nothing");
  } finally {
    globalThis.acksExtras = saved;
  }

  const { THROWS_DATA } = await import(new URL("../scripts/henchmen/data/throws-data.mjs", import.meta.url));
  assert.strictEqual(THROWS_DATA.tables.reactionToHiringOutcomes, undefined, "the shipped config carries no hiring column");
  const def = THROWS_DATA.throws.reactionToHiring;
  assert.strictEqual(def.outcomeTable, undefined, "and the throw names none");
  for (const id of ["previousRefusals", "slander"]) {
    assert.strictEqual(def.modifiers.find((m) => m.id === id).valuePerStep, undefined, `${id}: no per-count figure ships`);
  }
}

// ---- the hosted pages: an employer's powers offered, and the unvalued ones named by item ----
// The figures below are authored for the test; none is a page's.
{
  const { collectEffectModifiers, unvaluedPowerItems, unvaluedPowers, offeredRows, unvaluedNoteRows } = await import(
    new URL("../scripts/henchmen/effects.mjs", import.meta.url)
  );
  const ability = (id, name, effects) => ({ id, type: "ability", name, effects: [], flags: effects ? { "acks-extras": { extras: { effects } } } : {} });
  const onItem = (id, item, key, value) => ({ id, disabled: false, parent: { documentName: "Item", id: item.id }, flags: {}, changes: [{ key, type: "add", value: String(value) }] });
  const voice = ability("v", "Command of Voice");
  const aura = ability("g", "Glamorous Aura");
  const charm = ability("c", "Charming Ways");
  const reactionAe = onItem("rx", aura, "flags.acks-extras.reaction", 2);
  aura.effects = [reactionAe];
  const hiringAe = onItem("hx", charm, "flags.acks-extras.hiring", 3);
  const employer = {
    items: [voice, aura, charm, ability("d", "Diplomacy", [{ type: "modifier", target: "reaction", value: { kind: "flat", flat: 4 } }])],
    effects: [],
    appliedEffects: [reactionAe, hiringAe],
    system: { details: { level: 3 } },
  };
  assert.deepStrictEqual(unvaluedPowerItems(employer, "hiring"), [{ id: "v", name: "Command of Voice" }], "a power held by name alone is named with its item");
  assert.deepStrictEqual(unvaluedPowers(employer, "hiring"), ["Command of Voice"], "the names are the same walk");
  assert.deepStrictEqual(
    collectEffectModifiers(employer, "hiring").map(({ source, itemId }) => [source, itemId]),
    [["effect", "c"], ["influence-effect", "g"], ["ability", "d"]],
    "every found modifier names the item it rides"
  );
  assert.deepStrictEqual(
    offeredRows(employer, "hiring", { sources: ["effect"] }).map(({ id, value, situational, itemId }) => ({ id, value, situational, itemId })),
    [{ id: "fx-hx-hiring", value: 3, situational: false, itemId: "c" }],
    "a page that reads the reaction key and the page values itself is offered only the rest"
  );
  assert.strictEqual(offeredRows(employer, "hiring").length, 3, "with no filter every source is offered");
  assert.deepStrictEqual(offeredRows(null, "hiring"), [], "no employer, nothing offered");
  assert.deepStrictEqual(unvaluedNoteRows(employer, "hiring"), [{ label: "Command of Voice", note: true, itemId: "v" }], "a note per unvalued power, carrying its item");
  const commander = { items: [ability("k", "Command")], effects: [], appliedEffects: [], system: { details: { level: 3 } } };
  assert.deepStrictEqual(unvaluedNoteRows(commander, "henchmanMorale").map((n) => n.itemId), ["k"], "the obedience page names the morale power it cannot price");

  // What each opener hands the influence page, read off a stand-in api.open.
  const savedFoundry = globalThis.foundry;
  const savedExtras = globalThis.acksExtras;
  globalThis.foundry ??= { abstract: { DataModel: class {} }, data: { fields: {} } };
  try {
    const { openObedienceViaInfluence, openHiringViaInfluence } = await import(new URL("../scripts/henchmen/integrations/influence.mjs", import.meta.url));
    globalThis.acksExtras = { influence: { apiVersion: 11, open: (_actor, opts) => opts } };
    const steady = ability("o", "Fixture obedience power");
    const rally = ability("m", "Fixture morale power");
    const obeyAe = onItem("ox", steady, "flags.acks-extras.obedienceRoll", 1);
    const moraleAe = onItem("mx", rally, "flags.acks-extras.henchmanMorale", 2);
    const leader = { items: [steady, rally, ability("k", "Command")], effects: [], appliedEffects: [obeyAe, moraleAe], system: { details: { level: 3 } } };
    const obedience = openObedienceViaInfluence({ employer: leader, hireling: { name: "H", img: "" } });
    assert.deepStrictEqual(
      obedience.ctx.offeredModifiers.map(({ id, value, itemId }) => [id, value, itemId]),
      [["fx-ox-obedienceRoll", 1, "o"], ["fx-mx-henchmanMorale", 2, "m"]],
      "obedience is offered the employer's obedience and henchman-morale powers"
    );
    assert.deepStrictEqual(obedience.modifiers.map((n) => [n.note, n.itemId]), [[true, "k"]], "obedience names the morale power it cannot price");
    const hiring = openHiringViaInfluence({ employer, targetActor: null });
    assert.deepStrictEqual(hiring.ctx.offeredModifiers.map((r) => r.id), ["fx-hx-hiring"], "hiring is offered only what the page does not read itself");
    assert.deepStrictEqual(hiring.modifiers.map((n) => [n.note, n.itemId]), [[true, "v"]], "hiring names the power it cannot price");
  } finally {
    globalThis.foundry = savedFoundry;
    globalThis.acksExtras = savedExtras;
  }
}

console.log(`test-henchmen: OK (${macros.length} macros, bulk offers, network step, power values, henchman limit, network posting, hiring offer, hosted pages)`);
