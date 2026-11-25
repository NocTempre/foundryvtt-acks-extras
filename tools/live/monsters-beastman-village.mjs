/**
 * Live walk, the organisation roll through the API: docs/monsters/TESTING.md
 * "The organisation roll through the API", steps 1 to 8. A village is rolled into
 * a faction fixture from the imported family template, and every observable is read
 * back from the documents: each row's holder, the groups' officers and the host's
 * leader, the prototypes the stacks share, the whispered card, a reference nothing
 * answers, a gang sent out, hit by a casualty and recalled, a one-row Roll beside
 * rows it must leave byte-identical, a filled row refusing a second Roll, Delete
 * (the row, its groups, its prototypes, the leaders it leaves, a body on a map),
 * the `gen` record read back, and the treasure hand-off to a pot.
 * Machine values arrive through ./_env.mjs. Every name and figure here is invented.
 *
 * The imported family template is found by its structure, never by a name: the
 * library's Actor of type template whose axes hold the troop and trait axes and whose
 * variant options carry an encounter recipe. A world with none is `blocked`. Each
 * template and variant is tried in turn until one rolls a village of two groups or
 * more; a roll that made less is swept by its own ids before the next.
 *
 * Fixtures, kept and found again by marker (`api.fixture`):
 * `monsters/beastman-village` (the host faction) and `monsters/beastman-village-place`
 * (the location a gang is sent to). A step asserts the shape it reads at its start:
 * the host holds no row and no leader, the place no roster. Disposable, by the run's
 * own ledger: every id a roll made (`created`, the groups, the prototypes, the
 * leaders, the pot), every card and Delete's whisper, and the scene a body stands on.
 * The only writes outside the ledger are the kept fixtures' own shape, rewritten at
 * the start and again at the end. The sweep reports the ids Delete removed as
 * missing, which is expected.
 *
 * Not driven: a page reload between the roll and the `gen` read (the record is read
 * back from the world document, which the server holds); the card's own links and
 * tooltips are read as markup, never hovered.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const FACTION = "acks-extras.faction";
const LOCATION = "acks-extras.location";
const TAG = MACHINE.own ? ` ${MACHINE.own}` : "";
const ROLL = { context: "wilderness", state: "lair", scope: "below", rules: { troops: true, traits: true, gear: true } };
const MAX_ATTEMPTS = 14;

const tally = { pass: 0, fail: 0 };
const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const check = (label, ok, detail) => {
  tally[ok ? "pass" : "fail"] += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameSet = (a, b) => same([...(a ?? [])].sort(), [...(b ?? [])].sort());

/* Page side: each function is stringified and run in the GM seat's page. */
const P = {
  census: async () => ({
    user: game.user.name,
    role: game.user.role,
    activeGM: game.users.activeGM?.name ?? null,
    api: !!(globalThis.acksExtras?.monsters?.rollOrganisation && globalThis.acksExtras.lib?.org && globalThis.acksExtras.lib.groups && globalThis.acksExtras.lib.library),
  }),

  /** The imported family templates: a template actor with the troop and trait axes and a variant carrying an encounter recipe. */
  candidates: async () => {
    const library = acksExtras.lib.library;
    await library.whenReady();
    const found = [];
    for (const a of library.libraryActors()) {
      if (a.type !== "acks-extras.template" || a.flags?.world?.fixture) continue;
      const axes = a.system?.toObject?.().axes ?? a.system?.axes ?? [];
      const keys = axes.map((x) => x.key);
      if (!keys.includes("troop") || !keys.includes("trait")) continue;
      const variants = (axes.find((x) => x.key === "variant")?.options ?? [])
        .filter((o) => o.flags?.["acks-extras"]?.extras?.encounter?.recipe?.length)
        .map((o) => o.key);
      if (variants.length) found.push({ uuid: a.uuid, variants });
    }
    return found.sort((x, y) => (x.uuid < y.uuid ? -1 : 1));
  },

  /** The kept fixtures at their shape: the host with no row and no leader, the place with no roster. */
  shape: async ({ hostId, placeId }) => {
    const host = game.actors.get(hostId);
    const place = game.actors.get(placeId);
    const before = { rows: host.system.toObject().units.length, leader: host.system.leaderUuid ?? "", roster: place.system.roster.length };
    await host.update({ "system.units": [], "system.leaderUuid": "" });
    await place.update({ "system.roster": [] });
    return before;
  },

  messageIds: async () => game.messages.map((m) => m.id),

  /** One call of the organisation Roll over the host named by id, its answer reduced to plain values. */
  roll: async ({ hostId, ...args }) => {
    const host = game.actors.get(hostId);
    const r = await acksExtras.monsters.rollOrganisation({ host, ...args });
    return {
      ok: !!r.ok,
      reason: r.reason ?? null,
      created: r.created ?? [],
      made: r.made ?? { groups: [], prototypes: [], leaders: [] },
      reused: r.reused ?? [],
      pot: r.pot ?? null,
      group: r.group ?? "",
      findings: r.findings ?? [],
      treasure: r.treasure ?? null,
    };
  },

  /** The host's stored rows. */
  units: async ({ hostId }) => {
    const host = game.actors.get(hostId);
    return { units: host.system.toObject().units, leader: host.system.leaderUuid ?? "" };
  },

  /** Every row with its holder's group data: where it nests, its officer, its stacks. */
  rowsInfo: async ({ hostId }) => {
    const rows = game.actors.get(hostId).system.toObject().units;
    const out = [];
    for (const r of rows) {
      const doc = r.holderUuid ? await fromUuid(r.holderUuid) : null;
      const isGroup = doc?.type === "acks-extras.group";
      out.push({
        key: r.key,
        parentKey: r.parentKey,
        kind: r.kind,
        holderUuid: r.holderUuid,
        isGroup,
        name: doc?.name ?? "",
        parentGroup: isGroup ? doc.system.unit.parentGroupUuid : "",
        officer: isGroup ? doc.system.unit.officerUuid : "",
        children: rows.filter((c) => c.parentKey === r.key).length,
        stacks: isGroup ? doc.system.toObject().stacks.map((s) => ({ key: s.key, uuid: s.template?.uuid ?? "", current: s.size?.current ?? 0, onMap: (s.roster ?? []).some((m) => m.tokenUuid) })) : [],
      });
    }
    return out;
  },

  /** What a village left in the world: every holder, every group's officer and stacks, every prototype's flag key. */
  audit: async ({ hostId, groups, leaders, prototypes }) => {
    const host = game.actors.get(hostId);
    const units = host.system.toObject().units;
    const holders = [];
    for (const u of units) if (u.holderUuid) holders.push({ key: u.key, resolves: !!(await fromUuid(u.holderUuid)) });
    const out = [];
    const protos = {};
    for (const uuid of groups) {
      const g = await fromUuid(uuid);
      const officer = g?.system?.unit?.officerUuid ?? "";
      const stacks = g?.system?.toObject().stacks ?? [];
      out.push({
        uuid,
        officer,
        officerResolves: officer ? !!(await fromUuid(officer)) : false,
        officerIsLeader: leaders.includes(officer),
        stacks: stacks.map((s) => ({ uuid: s.template?.uuid ?? "", label: s.template?.label ?? "", part: s.gen?.part ?? "" })),
      });
      for (const s of stacks) {
        const u = s.template?.uuid;
        if (u && !(u in protos)) {
          const doc = await fromUuid(u);
          protos[u] = { resolves: !!doc, key: doc?.flags?.["acks-extras"]?.organisationPrototype ?? "" };
        }
      }
    }
    const holding = (flagKey) => game.actors.filter((a) => a.flags?.["acks-extras"]?.organisationPrototype === flagKey).length;
    const minted = [];
    for (const uuid of prototypes) {
      const doc = await fromUuid(uuid);
      const key = doc?.flags?.["acks-extras"]?.organisationPrototype ?? "";
      minted.push({ uuid, key, holding: key ? holding(key) : 0 });
    }
    return { holders, groups: out, protos, minted, leader: host.system.leaderUuid ?? "" };
  },

  /** The whispered organisation cards since `before` that name one of these groups. */
  cards: async ({ before, groups, words }) => {
    const gms = game.users.filter((u) => u.isGM).map((u) => u.id);
    const plain = (html) => { const el = document.createElement("div"); el.innerHTML = html; return el.textContent; };
    return game.messages
      .filter((m) => !before.includes(m.id) && groups.includes(m.flags?.["acks-extras"]?.organisationRoll?.group))
      .map((m) => ({
        id: m.id,
        toGMs: m.whisper.length > 0 && m.whisper.every((u) => gms.includes(u)) && gms.every((u) => m.whisper.includes(u)),
        pot: m.flags["acks-extras"].organisationRoll.pot ?? "",
        tooltips: (m.content.match(/data-tooltip/g) ?? []).length,
        links: (m.content.match(/content-link|data-uuid/g) ?? []).length,
        words: words.map((w) => plain(m.content).includes(w)),
      }));
  },

  /** One call on `acksExtras.lib.org` over the host, its answer reduced to plain values. */
  org: async ({ hostId, fn, args }) => {
    const host = game.actors.get(hostId);
    const r = await acksExtras.lib.org[fn](host, ...args);
    return Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, v?.documentName ? { uuid: v.uuid, name: v.name } : v]));
  },

  chart: async ({ hostId }) => {
    const chart = acksExtras.lib.org.orgChart(game.actors.get(hostId));
    return { total: chart.total, rows: chart.rows.map((r) => ({ key: r.key, count: r.count, covered: r.covered })) };
  },

  /** The place's roster, by uuid. */
  roster: async ({ placeId }) => game.actors.get(placeId).system.roster.map((r) => r.uuid),

  /** The group's nesting, its officer and its count of bodies. */
  groupOf: async ({ uuid }) => {
    const g = await fromUuid(uuid);
    return g ? { parent: g.system.unit.parentGroupUuid, count: acksExtras.lib.groups.bodyCount(g) } : null;
  },

  casualty: async ({ uuid, stackKey, n }) => acksExtras.lib.groups.applyCasualties(await fromUuid(uuid), stackKey, n),

  /** What `deleteRow` is about to take: the row's subtree, its groups, its officers, and each prototype either kept or removed. */
  preview: async ({ hostId, key }) => {
    const rows = game.actors.get(hostId).system.toObject().units;
    const sub = new Set([key]);
    for (let grew = true; grew;) {
      grew = false;
      for (const r of rows) if (!sub.has(r.key) && sub.has(r.parentKey)) { sub.add(r.key); grew = true; }
    }
    const groups = [];
    for (const r of rows) {
      if (!sub.has(r.key) || !r.holderUuid) continue;
      const g = await fromUuid(r.holderUuid);
      if (g?.type === "acks-extras.group") groups.push(g);
    }
    const gone = new Set(groups.map((g) => g.uuid));
    const stacksOf = (g) => g.system.toObject().stacks;
    const candidates = new Set(groups.flatMap((g) => stacksOf(g).flatMap((s) => [s.template?.uuid, s.gen?.mount?.uuid])).filter(Boolean));
    const others = game.actors.filter((a) => a.type === "acks-extras.group" && !gone.has(a.uuid));
    const named = (u) => others.some((g) => stacksOf(g).some((s) => s.template?.uuid === u || s.gen?.mount?.uuid === u));
    const prototypes = [];
    const kept = [];
    for (const u of candidates) {
      const proto = await fromUuid(u);
      if (!proto?.flags?.["acks-extras"]?.organisationPrototype) continue;
      (named(u) ? kept : prototypes).push(u);
    }
    return {
      rows: [...sub],
      groups: [...gone],
      prototypes,
      kept,
      leaders: [...new Set(groups.map((g) => g.system?.unit?.officerUuid).filter(Boolean))],
    };
  },

  /** Which of these uuids resolve to a document now. */
  exists: async ({ uuids }) => {
    const out = {};
    for (const u of uuids) out[u] = !!(await fromUuid(u));
    return out;
  },

  deploy: async ({ uuid, sceneId, stackKey }) => {
    const made = await acksExtras.lib.groups.deploy(await fromUuid(uuid), game.scenes.get(sceneId), { stackKey, count: 1, x: 100, y: 100 });
    return made.length;
  },

  /** The whispers a deleted row's group spoke, with the line the lang key gives. */
  deleteWhispers: async ({ before, alias, name }) => {
    const gms = game.users.filter((u) => u.isGM).map((u) => u.id);
    const said = game.i18n.format("ACKS-LIB.org.delete.onMap", { name });
    const plain = (html) => { const el = document.createElement("div"); el.innerHTML = html; return el.textContent; };
    return game.messages
      .filter((m) => !before.includes(m.id) && m.speaker?.alias === alias && plain(m.content).includes(said))
      .map((m) => ({ id: m.id, toGMs: m.whisper.length > 0 && m.whisper.every((u) => gms.includes(u)) }));
  },

  /** The deal list of a pot, each row's creature and hoards. */
  deal: async ({ pot }) => {
    const { potOf } = await import("/modules/acks-extras/scripts/treasure/pot.mjs");
    const doc = await fromUuid(pot);
    return doc ? (potOf(doc).deal.monsters ?? []).map((m) => ({ actorId: m.actorId, hoards: m.hoards })) : null;
  },

  /** The root row's `gen` read from the world document. */
  genRead: async ({ hostUuid }) => {
    const host = await fromUuid(hostUuid);
    const root = host.system.toObject().units.find((u) => !u.parentKey && u.gen?.template);
    if (!root) return null;
    return { template: root.gen.template, resolves: !!(await fromUuid(root.gen.template)), variant: root.gen.variant ?? "", state: root.gen.state ?? "", context: root.gen.context ?? "" };
  },
};

const run = (api, fn, arg) => api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);

/** Read a page function until `test` passes, or give the last reading back. */
async function until(api, fn, arg, test, { tries = 40, every = 250 } = {}) {
  let value;
  for (let n = 0; n < tries; n++) {
    value = await run(api, fn, arg);
    if (test(value)) return value;
    await sleep(every);
  }
  return value;
}

const open = {};
const swept = [];
let shapeArgs = null;

try {
  section("seat");
  open.gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  const gm = open.gm;
  const census = await run(gm, P.census);
  note("active GM", { name: census.activeGM, seat: census.user });
  if (!census.api) blocked("acksExtras.monsters.rollOrganisation or acksExtras.lib.org, .groups or .library is not on the page: the module did not load");
  check("the seat is a GM", census.role >= 3, census.role);

  /** Track every uuid in the run's ledger and its sweep list. */
  const own = (uuids) => (uuids ?? []).filter(Boolean).map((u) => { const t = gm.track(u); if (!swept.includes(t)) swept.push(t); return t; });
  /** Track a roll's cards, found by the groups it made. */
  const takeCards = async (r, before, words = []) => {
    const cards = await until(gm, P.cards, { before, groups: r.made.groups, words }, (c) => c.length >= 1, { tries: 12 });
    for (const c of cards) own([gm.track(c.id, "ChatMessage")]);
    return cards;
  };
  /** Delete what a roll that is not kept made, by its own ids, and leave the host empty. */
  const discard = async (hostId, r, cards) => {
    const ids = [...own(r.created), ...cards.map((c) => `ChatMessage.${c.id}`)];
    if (ids.length) await gm.sweepTracked({ only: ids });
    for (const u of ids) { const at = swept.indexOf(u); if (at >= 0) swept.splice(at, 1); }
    await run(gm, P.shape, shapeArgs);
  };

  section("the imported template");
  const candidates = await run(gm, P.candidates);
  note("candidates", candidates.map((c) => ({ variants: c.variants.length })));
  if (!candidates.length) blocked("the world holds no imported family template with the troop and trait axes and a variant carrying an encounter recipe: import the monster book and its organisation tables first");

  section("fixtures");
  const host = await gm.fixture("monsters/beastman-village", "Actor", { name: `QA Village host${TAG}`, type: FACTION, items: [] });
  // A Judge's note keeps the place out of the empty-location prune.
  const place = await gm.fixture("monsters/beastman-village-place", "Actor", { name: `QA Village place${TAG}`, type: LOCATION, items: [], system: { gmNotes: "<p>Walk place</p>" } });
  shapeArgs = { hostId: host.id, placeId: place.id };
  note("found at", await run(gm, P.shape, shapeArgs));
  let s = await run(gm, P.units, { hostId: host.id });
  check("the kept host stands at its shape: no row and no leader", !s.units.length && s.leader === "", s);
  check("the kept place stands at its shape: an empty roster", !(await run(gm, P.roster, { placeId: place.id })).length);

  section("1. a village is rolled");
  let accepted = null;
  const tried = [];
  let attempts = 0;
  search: for (const c of candidates) {
    for (const variant of c.variants) {
      if (++attempts > MAX_ATTEMPTS) break search;
      const before = await run(gm, P.messageIds);
      const r = await run(gm, P.roll, { hostId: host.id, template: c.uuid, variant, ...ROLL });
      own(r.created);
      const cards = r.ok ? await takeCards(r, before) : [];
      tried.push({ ok: r.ok, reason: r.reason, groups: r.made.groups.length, leaders: r.made.leaders.length });
      if (r.ok && r.made.groups.length >= 2 && r.made.leaders.length) { accepted = { r, cards, template: c.uuid, variant, before }; break search; }
      await discard(host.id, r, cards);
    }
  }
  note("attempts", tried);
  if (!accepted) blocked(`no imported template and variant rolled a village of two groups or more in ${tried.length} attempts: ${JSON.stringify(tried)}`);
  const { r: village, template, variant } = accepted;
  check("the roll answers ok and made groups, prototypes and leaders", village.ok && village.made.groups.length >= 2 && village.made.prototypes.length >= 1 && village.made.leaders.length >= 1, { groups: village.made.groups.length, prototypes: village.made.prototypes.length, leaders: village.made.leaders.length, reused: village.reused.length });
  if (village.reused.length) note("NOTE", `${village.reused.length} prototype(s) were found already minted and reused, so Delete's accounting below is limited to ones this run made`);
  const refWords = village.findings.filter((f) => f.what === "reference").map((f) => f.word);
  const audit = await run(gm, P.audit, { hostId: host.id, groups: village.made.groups, leaders: village.made.leaders, prototypes: village.made.prototypes });
  check("every row's holderUuid resolves", audit.holders.length >= 2 && audit.holders.every((h) => h.resolves), audit.holders.filter((h) => !h.resolves));
  const withOfficer = audit.groups.filter((g) => g.officer);
  check("each group's officer resolves to a leader the roll made, and the top group has one", withOfficer.length >= 1 && withOfficer.every((g) => g.officerResolves && g.officerIsLeader) && !!audit.groups.find((g) => g.uuid === village.group)?.officer, { groups: audit.groups.length, withOfficer: withOfficer.length });
  note("NOTE", `${audit.groups.length - withOfficer.length} of ${audit.groups.length} groups name no officer`);
  const topGroup = audit.groups.find((g) => g.uuid === village.group);
  check("the host's leaderUuid is the top group's officer", !!topGroup?.officer && audit.leader === topGroup.officer, { leader: audit.leader === "" ? "blank" : audit.leader === topGroup?.officer ? "the top officer" : "another" });
  const stacks = audit.groups.flatMap((g) => g.stacks);
  const named = stacks.filter((st) => st.uuid);
  check("every stack that names a prototype names one that resolves", named.length >= 1 && named.every((st) => audit.protos[st.uuid]?.resolves), { stacks: stacks.length, named: named.length });
  check("each prototype key is held by one actor, so stacks of one body kind share one template uuid", audit.minted.length >= 1 && audit.minted.every((m) => m.key && m.holding === 1), audit.minted.map((m) => m.holding));
  const distinct = new Set(named.map((st) => st.uuid));
  if (named.length > distinct.size) note("NOTE", `${named.length} stacks name ${distinct.size} prototypes, so ${named.length - distinct.size} share`);
  else console.log(`OBSERVED  no two stacks of this roll shared a prototype (${named.length} stacks, ${distinct.size} prototypes)`);
  const cards = accepted.cards.length ? await takeCards(village, accepted.before, refWords) : [];
  note("cards", cards.map((c) => ({ toGMs: c.toGMs, tooltips: c.tooltips, links: c.links })));
  check("one card is whispered to the Judges alone, flagged with the top group and carrying markup with tooltips and links", cards.length === 1 && cards[0].toGMs && cards[0].tooltips > 0 && cards[0].links > 0, cards.map((c) => ({ toGMs: c.toGMs, tooltips: c.tooltips, links: c.links })));
  check("the pot the card carries is the pot the roll answered", cards.length === 1 && cards[0].pot === (village.pot ?? ""), { card: !!cards[0]?.pot, roll: !!village.pot });

  section("2. a reference nothing answers");
  if (refWords.length) {
    const labelled = stacks.filter((st) => !st.uuid && st.label);
    check("each unresolved reference is a finding, and a labelled stack holds the printed word", labelled.length >= 1 && refWords.some((w) => labelled.some((st) => st.label === w)), { findings: refWords.length, statuses: village.findings.filter((f) => f.what === "reference").map((f) => f.status), labelled: labelled.length });
    check("the card lists each reference's word", cards.length === 1 && cards[0].words.every(Boolean), cards[0]?.words);
  } else {
    console.log(`OBSERVED  this roll produced no reference finding (${village.findings.length} findings: ${[...new Set(village.findings.map((f) => f.what))].join(", ") || "none"}), so the labelled-stack path was not reached`);
  }

  section("3. a gang is sent out, takes a casualty and is recalled");
  const info = await run(gm, P.rowsInfo, { hostId: host.id });
  const holderOfRow = (key) => info.find((i) => i.key === key)?.holderUuid;
  const gang = info.find((i) => i.isGroup && !i.children && i.parentKey && i.stacks.some((st) => st.current >= 1) && i.parentGroup && i.parentGroup === holderOfRow(i.parentKey));
  check("a gang row nests inside its parent row's group", !!gang, info.map((i) => ({ leaf: !i.children, nested: !!i.parentGroup, bodies: i.stacks.length })));
  if (gang) {
    const parentRow = info.find((i) => i.key === gang.parentKey);
    const stack = gang.stacks.find((st) => st.current >= 1);
    const chartOf = async () => { const c = await run(gm, P.chart, { hostId: host.id }); return { total: c.total, parent: c.rows.find((x) => x.key === parentRow.key), gang: c.rows.find((x) => x.key === gang.key) }; };
    const start = await chartOf();
    const out = await run(gm, P.org, { hostId: host.id, fn: "sendOut", args: [gang.key, place.uuid] });
    const afterOut = await chartOf();
    const roster = await run(gm, P.roster, { placeId: place.id });
    const nest = await run(gm, P.groupOf, { uuid: gang.holderUuid });
    check("sendOut answers ok, the place's roster holds the gang and the gang left its parent", out.ok === true && same(roster, [gang.holderUuid]) && nest.parent === "", { ok: out.ok, roster: roster.length, parent: nest.parent === "" ? "blank" : "set" });
    check("the parent row's count falls by the gang's, and the gang's row reads uncovered", afterOut.parent.count === start.parent.count - start.gang.count && afterOut.gang.covered === false && afterOut.gang.count === start.gang.count, { start: [start.parent.count, start.gang.count], out: [afterOut.parent.count, afterOut.gang.count, afterOut.gang.covered] });
    const fell = await run(gm, P.casualty, { uuid: gang.holderUuid, stackKey: stack.key, n: 1 });
    const afterHit = await chartOf();
    check("a casualty answers 1 and the gang's count is one less", fell === 1 && afterHit.gang.count === start.gang.count - 1, { fell, gang: afterHit.gang.count, was: start.gang.count });
    const back = await run(gm, P.org, { hostId: host.id, fn: "recall", args: [gang.key] });
    const afterBack = await chartOf();
    const rosterBack = await run(gm, P.roster, { placeId: place.id });
    const nestBack = await run(gm, P.groupOf, { uuid: gang.holderUuid });
    check("recall answers ok, the gang is inside its parent's group and the roster is empty", back.ok === true && nestBack.parent === parentRow.holderUuid && !rosterBack.length, { ok: back.ok, parentIsRowHolder: nestBack.parent === parentRow.holderUuid, roster: rosterBack.length });
    check("the counts return with the casualty kept: the parent's is one less than it began and the gang reads covered", afterBack.parent.count === start.parent.count - 1 && afterBack.gang.covered === true && afterBack.gang.count === start.gang.count - 1 && afterBack.total === start.total - 1, { parent: [start.parent.count, afterBack.parent.count], gang: afterBack.gang.count, total: [start.total, afterBack.total] });
  }

  section("4. a one-row Roll leaves the other rows byte-identical");
  const top = (await run(gm, P.units, { hostId: host.id })).units.find((u) => !u.parentKey);
  const kinds = [...new Set([...info.filter((i) => i.children && i.parentKey).map((i) => i.kind), ...info.filter((i) => i.children).map((i) => i.kind), ...info.map((i) => i.kind)].filter(Boolean))];
  let one = null;
  for (const kind of kinds) {
    const added = await run(gm, P.org, { hostId: host.id, fn: "addRow", args: [top.key, { kind }] });
    if (!added.ok) continue;
    const snapshot = (await run(gm, P.units, { hostId: host.id })).units;
    const before = await run(gm, P.messageIds);
    const r = await run(gm, P.roll, { hostId: host.id, rowKey: added.key });
    own(r.created);
    const cards1 = r.ok ? await takeCards(r, before) : [];
    const after = (await run(gm, P.units, { hostId: host.id })).units;
    const fresh = after.filter((u) => !snapshot.some((x) => x.key === u.key));
    if (r.ok && fresh.length) { one = { key: added.key, kind, r, snapshot, after, fresh, cards: cards1 }; break; }
    note("kind tried", { kind: kinds.indexOf(kind), ok: r.ok, reason: r.reason, rows: fresh.length });
    await run(gm, P.org, { hostId: host.id, fn: "deleteRow", args: [added.key] });
  }
  check("a unit kind rolled into the added row, answering ok and writing new rows beneath it", !!one, { kinds: kinds.length });
  let rowRolled = null;
  if (one) {
    rowRolled = one.key;
    const others = one.snapshot.filter((u) => u.key !== one.key);
    const afterByKey = new Map(one.after.map((u) => [u.key, u]));
    check("every other row is byte-identical by JSON.stringify", others.every((u) => JSON.stringify(afterByKey.get(u.key)) === JSON.stringify(u)), others.filter((u) => JSON.stringify(afterByKey.get(u.key)) !== JSON.stringify(u)).length);
    const rolled = afterByKey.get(one.key);
    check("the rolled row now holds a group this roll made",!!rolled.holderUuid && one.r.made.groups.includes(rolled.holderUuid), { holder: !!rolled.holderUuid });
    const below = (key) => { for (let at = afterByKey.get(key); at; at = afterByKey.get(at.parentKey)) if (at.parentKey === one.key) return true; return false; };
    check("every new row is beneath the rolled row", one.fresh.every((u) => below(u.key)), one.fresh.length);
    const empties = one.fresh.filter((u) => !u.holderUuid);
    if (empties.length) check("the new empty rows' gen carry shareKind and troop", empties.every((u) => !!u.gen?.shareKind && !!u.gen?.troop), empties.map((u) => ({ shareKind: !!u.gen?.shareKind, troop: !!u.gen?.troop })));
    else console.log(`OBSERVED  the one-row roll left no empty row (${one.fresh.length} new rows, all filled), so shareKind and troop on an empty row were not read`);
    check("the roll posted one card, to the Judges", one.cards.length === 1 && one.cards[0].toGMs, one.cards.map((c) => c.toGMs));
    note("NOTE", "the walk rolled an added row below the top with no template argument; template, variant, state and rules came from the root row's gen");
  }

  section("5. a filled row refuses a second Roll");
  if (rowRolled) {
    const unitsBefore = (await run(gm, P.units, { hostId: host.id })).units;
    const idsBefore = await run(gm, P.messageIds);
    const again = await run(gm, P.roll, { hostId: host.id, rowKey: rowRolled });
    own(again.created);
    const unitsAfter = (await run(gm, P.units, { hostId: host.id })).units;
    const idsAfter = await run(gm, P.messageIds);
    check("the answer is ok false, reason filled, with nothing made", again.ok === false && again.reason === "filled" && !again.created.length, { ok: again.ok, reason: again.reason, created: again.created.length });
    check("the host's units are byte-identical and no message was posted", same(unitsBefore, unitsAfter) && same(idsBefore, idsAfter), { units: same(unitsBefore, unitsAfter), messages: idsAfter.length - idsBefore.length });
  } else {
    check("a filled row to roll again", false, "step 4 made none");
  }

  section("6. Delete");
  const infoNow = await run(gm, P.rowsInfo, { hostId: host.id });
  const addedKeys = new Set([...(one ? [one.key, ...one.fresh.map((u) => u.key)] : [])]);
  const leaves = infoNow.filter((i) => i.isGroup && !i.children && i.parentKey && !addedKeys.has(i.key));
  const previews = [];
  for (const l of leaves) previews.push({ row: l, plan: await run(gm, P.preview, { hostId: host.id, key: l.key }) });
  // A prototype this run did not make is never one Delete removes here.
  const mineOnly = (p) => p.plan.prototypes.every((u) => swept.includes(u));
  const usable = previews.filter(mineOnly);
  const chosen = usable.find((p) => p.plan.kept.length) ?? usable.find((p) => p.plan.prototypes.length) ?? usable[0] ?? null;
  check("a leaf gang row to delete", !!chosen, { leaves: leaves.length, usable: usable.length });
  if (chosen) {
    const { row, plan } = chosen;
    note("expected", { rows: plan.rows.length, groups: plan.groups.length, prototypes: plan.prototypes.length, kept: plan.kept.length, leaders: plan.leaders.length });
    const hostBefore = await run(gm, P.units, { hostId: host.id });
    const del = await run(gm, P.org, { hostId: host.id, fn: "deleteRow", args: [row.key] });
    check("Delete answers ok, with no warning", del.ok === true && !(del.warnings ?? []).length, { ok: del.ok, reason: del.reason, warnings: del.warnings });
    check("its rows, groups, prototypes, kept and leaders are what the preview named", sameSet(del.rows, plan.rows) && sameSet(del.groups, plan.groups) && sameSet(del.prototypes, plan.prototypes) && sameSet(del.kept, plan.kept) && sameSet(del.leaders, plan.leaders), { rows: del.rows?.length, groups: del.groups?.length, prototypes: del.prototypes?.length, kept: del.kept?.length, leaders: del.leaders?.length });
    const after = await run(gm, P.exists, { uuids: [...plan.groups, ...plan.prototypes, ...plan.kept, ...plan.leaders] });
    check("the deleted groups are gone", plan.groups.every((u) => after[u] === false), plan.groups.map((u) => after[u]));
    check("a prototype no stack names is gone and one another stack names stays", plan.prototypes.every((u) => after[u] === false) && plan.kept.every((u) => after[u] === true), { removed: plan.prototypes.length, kept: plan.kept.length });
    check("the leaders it left stand", plan.leaders.every((u) => after[u] === true), plan.leaders.map((u) => after[u]));
    if (!plan.kept.length) console.log("OBSERVED  no prototype of the deleted row was named by another stack, so Delete's kept path was not reached");
    const hostAfter = await run(gm, P.units, { hostId: host.id });
    const planned = new Set(plan.rows);
    check("the row and its subtree are off the host and every other row is byte-identical", hostAfter.units.every((u) => !planned.has(u.key)) && hostBefore.units.filter((u) => !planned.has(u.key)).every((u) => JSON.stringify(hostAfter.units.find((x) => x.key === u.key)) === JSON.stringify(u)), { before: hostBefore.units.length, after: hostAfter.units.length });
    own(del.leaders);
    note("NOTE", "the deleted groups and prototypes were tracked when the roll made them; the sweep reports them as missing, which is expected");

    section("6b. Delete with a body on a map");
    const scene = await gm.create("Scene", { name: `QA Village scene${TAG}`, width: 1200, height: 800, grid: { size: 100 } });
    own([scene.uuid]);
    const second = previews.filter((p) => p.row.key !== row.key && mineOnly(p) && p.row.stacks.some((st) => st.uuid)).find((p) => !p.plan.rows.some((k) => plan.rows.includes(k))) ?? null;
    check("a second leaf gang row whose stack names a prototype", !!second, previews.length);
    if (second) {
      const stack = second.row.stacks.find((st) => st.uuid);
      const placed = await run(gm, P.deploy, { uuid: second.row.holderUuid, sceneId: scene.id, stackKey: stack.key });
      check("one body is deployed on the scene", placed === 1, placed);
      const before = await run(gm, P.messageIds);
      const del2 = await run(gm, P.org, { hostId: host.id, fn: "deleteRow", args: [second.row.key] });
      check("Delete answers ok with warnings onMap", del2.ok === true && same(del2.warnings, ["onMap"]), { ok: del2.ok, reason: del2.reason, warnings: del2.warnings });
      const whispers = await until(gm, P.deleteWhispers, { before, alias: second.row.name, name: second.row.name }, (w) => w.length >= 1, { tries: 12 });
      for (const w of whispers) own([gm.track(w.id, "ChatMessage")]);
      check("one whisper to the Judges says the body was on a map", whispers.length === 1 && whispers[0].toGMs, whispers);
      const gone = await run(gm, P.exists, { uuids: del2.groups ?? [] });
      check("its group is gone", (del2.groups ?? []).length >= 1 && (del2.groups ?? []).every((u) => gone[u] === false));
      own(del2.leaders);
    }
  }

  section("7. the gen record");
  const gen = await run(gm, P.genRead, { hostUuid: host.uuid });
  check("the root row's gen.template is the family the roll was made from and it resolves", !!gen && gen.template === template && gen.resolves && gen.variant === variant, gen && { template: gen.template === template, resolves: gen.resolves, variant: gen.variant === variant, state: gen.state, context: gen.context });
  note("NOTE", "read back from the world document through fromUuid, not after a page reload; the client was not reloaded");

  section("8. the treasure hand-off");
  const deals = village.treasure?.deal === true;
  check("a lair roll deals", deals, village.treasure);
  if (deals && village.pot) {
    const rows = await run(gm, P.deal, { pot: village.pot });
    check("the pot's deal list holds a creature row with hoards the line gave", !!rows?.some((m) => Number(m.hoards) === village.treasure.hoards), { rows: rows?.length, hoards: village.treasure.hoards });
    const before2 = await run(gm, P.messageIds);
    const r2 = await run(gm, P.roll, { hostId: host.id, template, variant, ...ROLL, pot: village.pot });
    own(r2.created);
    const cards2 = r2.ok ? await takeCards(r2, before2) : [];
    check("a second roll with the pot given answers ok and makes no second pot", r2.ok && r2.pot === village.pot && !r2.created.includes(village.pot), { ok: r2.ok, reason: r2.reason, samePot: r2.pot === village.pot });
    const rows2 = await run(gm, P.deal, { pot: village.pot });
    const shared = (rows ?? []).filter((m) => (rows2 ?? []).some((n) => n.actorId === m.actorId));
    if (r2.ok && r2.treasure?.deal && shared.length) {
      check("a creature already on the list has its hoards raised by the second line's", shared.every((m) => (rows2.find((n) => n.actorId === m.actorId).hoards) === (Number(m.hoards) || 1) + r2.treasure.hoards), shared.map((m) => ({ was: m.hoards, now: rows2.find((n) => n.actorId === m.actorId).hoards, add: r2.treasure.hoards })));
    } else {
      console.log(`OBSERVED  the second roll's first creature with a treasure type was not on the list, so no hoards were raised (${rows?.length} rows, then ${rows2?.length}; dealt ${r2.treasure?.deal === true}, pot kept ${r2.pot === village.pot})`);
    }
    check("the second roll's card is whispered to the Judges", !r2.ok || (cards2.length === 1 && cards2[0].toGMs), cards2.map((c) => c.toGMs));
  } else {
    console.log(`OBSERVED  the roll dealt but handed no pot (${deals}; no created creature carried a treasure type), so the hand-off was not reached`);
  }

  walkDone();
} catch (err) {
  console.log(`WALK ERROR: ${err?.message ?? err}`);
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  section("teardown");
  try { if (open.gm && swept.length) note("swept", await open.gm.sweepTracked({ only: swept })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  try { if (open.gm && shapeArgs) note("shape at the end", await run(open.gm, P.shape, shapeArgs)); } catch (err) { console.error("shape:", err?.message ?? err); }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
}
