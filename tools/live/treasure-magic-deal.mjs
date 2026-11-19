/**
 * Live walk, treasure magic deal: a dealt hoard's magic cards rolled on the
 * world's imported item tables. Walks docs/treasure/TESTING.md "Dealing letters
 * (Judge seat)", step 8. The GM seat deals a treasure type whose magic cell
 * names a kind into a pot staged By hand, in the classic and then the heroic
 * style; the Player seat turns the rolled cards of the opened pot through the
 * relay and reads them as its window would. Every observable is a boolean, a
 * count or a refusal code: the walk prints no treasure letter, noun, caption,
 * item name or figure. Machine values arrive through ./_env.mjs; the shared
 * seat plumbing is ./_treasure-kit.mjs.
 *
 * Covers: the registries (the treasure registry and the item tables both
 * imported, with list counts); the noun-to-list match against the real
 * import, as a census of every treasure type in both styles counted by
 * outcome, the first observable, since no offline suite holds real forms; a
 * classic deal (rolled cards, audit rows, the refusal codes of any card left a
 * placeholder); a rolled card never named for its item on a seat's turned face;
 * a linked card's claim data knowing no identification and no curse; a heroic
 * deal rolling on the rarity lists; No magic striking rolled cards at open; the
 * pot's arms column set by API (T6c-2; the deal panel's control is T6c-3) and
 * sixty rolls on the weapons list, each stored arm's base cost checked against
 * its document and its masterwork cost against the tier's `costAdd`, ranking at
 * their sum. Needs the equipment tables and the masterwork documents imported,
 * and the Tome's arms grids re-imported so rows carry their `arms` links.
 *
 * Scripted: the deal itself (`dealLettersIntoPot`, the rail's own call; the
 * rail's Deal press is walked by treasure-deal), the die (held at its floor
 * around each deal, so a chance cell always hits and the walk reads the first
 * band of each list), the open (`openPot`), and the Player seat's turns (the
 * relay request its window's flip sends).
 *
 * Not reached: a noun matching two lists, and a world with no item tables
 * (both offline only, test-treasure-magic-deal); the turned face as rendered
 * pixels (the walk reads `cardView`, which the window's template prints).
 *
 * The pots and their doorway cards are the run's own, tracked and swept by id.
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { MACHINE, PORTS, P as K, run, note, section, check, checks, openSeats, finish, watchdog } from "./_treasure-kit.mjs";

const MOD = "/modules/acks-extras/scripts";

const P = {
  ...K,
  /**
   * The registries, and a census of every treasure type in both styles under a
   * floor die: each magic placeholder's match (`startFor`) counted by outcome,
   * and the first type per style with a placeholder that names a list by its
   * noun (a type-list placeholder's type only where none does).
   */
  probe: async ({ mod }) => {
    const T = await import(`${mod}/lib/tables.mjs`);
    const B = await import(`${mod}/importer/treasure-binding.mjs`);
    const Hd = await import(`${mod}/treasure/hoard.mjs`);
    const Mg = await import(`${mod}/treasure/magic-deal-logic.mjs`);
    const starts = globalThis.acksExtras?.magicItems?.starts?.() ?? null;
    const lists = { classic: starts?.classic?.length ?? 0, heroic: starts?.heroic?.length ?? 0 };
    const census = { classic: { placeholders: 0, matched: 0, reasons: {} }, heroic: { placeholders: 0, matched: 0, reasons: {} } };
    const letter = { classic: null, heroic: null };
    const fallback = { classic: null, heroic: null };
    if (!T.hasDoc(B.TREASURE_DOC_ID)) return { treasure: false, lists, census, letter, tried: 0 };
    const keys = Object.keys(T.getDoc(B.TREASURE_DOC_ID).tables?.typeClassic ?? {});
    const orig = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => 0;
    try {
      for (const key of keys) {
        for (const style of ["classic", "heroic"]) {
          const open = await Hd.dealHoard({ letter: key, style, toggles: {} });
          for (const x of open.truths ?? []) {
            if (x.pool !== "magic" || !("tableRef" in x)) continue;
            const c = census[style];
            c.placeholders++;
            const m = Mg.startFor(x.tableRef, style, starts, { typeList: x.typeList === true });
            if (m.ok) {
              c.matched++;
              if (!x.typeList) letter[style] ??= key;
              else fallback[style] ??= key;
            } else c.reasons[m.reason] = (c.reasons[m.reason] ?? 0) + 1;
          }
        }
      }
    } finally {
      CONFIG.Dice.randomUniform = orig;
    }
    return { treasure: true, lists, census, letter: { classic: letter.classic ?? fallback.classic, heroic: letter.heroic ?? fallback.heroic }, tried: keys.length };
  },
  /** Deal one letter into a fresh pot staged By hand, the die at its floor; read back what the pot holds. */
  deal: async ({ mod, letter, style, noMagic }) => {
    const D = await import(`${mod}/treasure/deal.mjs`);
    const Pm = await import(`${mod}/treasure/pot.mjs`);
    const L = await import(`${mod}/treasure/pot-logic.mjs`);
    const pile = await globalThis.acksExtras.treasure.newDealPot([]);
    if (!pile) return { made: false };
    if (noMagic === "before") await Pm.setDealToggle(pile, "noMagic", true);
    const orig = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => 0;
    let out;
    try {
      out = await D.dealLettersIntoPot(pile, { letters: [letter], style, confirmLair: async () => true });
    } finally {
      CONFIG.Dice.randomUniform = orig;
    }
    if (noMagic === "after") await Pm.setDealToggle(pile, "noMagic", true);
    const cards = Pm.viewOf(pile).cards;
    const truths = cards.map((c) => c.truth);
    const magic = truths.filter((t) => t.pool === "magic");
    const isRolled = (t) => t.pool === "magic" && !!t.mask?.name && t.label !== t.mask.name;
    const rolled = magic.filter(isRolled);
    const linked = rolled.filter((t) => t.source?.uuid && t.source?.data);
    const errors = (out?.dealt ?? []).flatMap((d) => d.errors ?? []);
    const claim = linked[0] ? L.claimItemData(linked[0], (d, m) => ({ ...d, name: m.name })) : null;
    const cm = claim?.flags?.["acks-extras"]?.markets ?? null;
    return {
      made: true,
      uuid: pile.uuid,
      potId: pile.id,
      ok: !!out?.ok,
      cards: truths.length,
      magic: magic.length,
      rolled: rolled.length,
      linked: linked.length,
      audit: (out?.dealt ?? []).flatMap((d) => d.audit ?? []).filter((a) => a.magic).length,
      starts: [...new Set((out?.dealt ?? []).flatMap((d) => d.audit ?? []).filter((a) => a.magic).map((a) => String(a.start ?? "").split(".")[0]))],
      reasons: errors.filter((e) => e.code === "magic-not-rolled").map((e) => e.reason),
      unknown: rolled.every((t) => t.magical && t.detected === false && t.identified === "none"),
      judgeHidden: rolled.every((t) => L.apparentName(t) !== t.label),
      claimKnowsNothing: claim ? cm?.identified === "none" && cm?.detected === false && cm?.curseKnown === undefined && cm?.magic === true && claim.name !== linked[0].label : null,
      rolledIds: cards.filter((c) => isRolled(c.truth)).map((c) => c.id),
      apparentCarried: linked.filter((t) => L.apparentWorth(t) != null).length,
      apparentRanked: linked.filter((t) => L.apparentWorth(t) != null && !(t.mask?.cost != null && t.mask.cost !== "") && L.rankWorth(t) === L.apparentWorth(t)).length,
    };
  },
  /**
   * The pot's arms column, set by API (the deal panel's control is a later slice): read back on the pot,
   * kept as the next new pot's default, then cleared. Counts and booleans only.
   */
  column: async ({ mod, key }) => {
    const Pm = await import(`${mod}/treasure/pot.mjs`);
    const L = await import(`${mod}/treasure/pot-logic.mjs`);
    const pile = await globalThis.acksExtras.treasure.newDealPot([]);
    if (!pile) return { made: false };
    const flagBefore = game.user.getFlag("acks-extras", "treasureArms") ?? "";
    await Pm.setDealOption(pile, "armsSetting", key);
    const set = Pm.potOf(pile).deal.armsSetting;
    const refused = (await Pm.setDealOption(pile, "armsSetting", "not-a-column")) === null;
    const next = await globalThis.acksExtras.treasure.newDealPot([]);
    const inherited = next ? Pm.potOf(next).deal.armsSetting : null;
    await Pm.setDealOption(pile, "armsSetting", "");
    const cleared = Pm.potOf(pile).deal.armsSetting === "" && (game.user.getFlag("acks-extras", "treasureArms") ?? "") === "";
    if (flagBefore) await game.user.setFlag("acks-extras", "treasureArms", flagBefore);
    return { made: true, uuids: [pile.uuid, next?.uuid].filter(Boolean), set: set === key, refused, inherited: inherited === key, cleared, valid: L.normalizePot({ deal: { armsSetting: key } }).deal.armsSetting === key };
  },
  /**
   * Sixty rolls on the classic list the noun `noun` names, with the setting `key`, through the real roll
   * service and the real seam: every card that stores `apparent` is checked against its base's document
   * (`system.cost`) and the masterwork tier's `costAdd` for the base's kind, and ranks at their sum.
   * Counts and booleans only: no name or figure is returned.
   */
  arms: async ({ mod, key }) => {
    const Mg = await import(`${mod}/treasure/magic-deal-logic.mjs`);
    const D = await import(`${mod}/treasure/deal.mjs`);
    const L = await import(`${mod}/treasure/pot-logic.mjs`);
    const W = await import(`${mod}/equipment/printed-layers.mjs`);
    const starts = globalThis.acksExtras.magicItems.starts();
    const noun = starts?.classic?.find((e) => /weapon/i.test(`${e.key} ${e.caption}`))?.caption ?? null;
    if (!noun) return { noList: true };
    const seam = await D.armsSeam();
    const dice = (expr) => { const sides = Number(String(expr).slice(String(expr).indexOf("d") + 1)); return { total: 1 + Math.floor(Math.random() * sides), sides }; };
    const placeholders = Array.from({ length: 60 }, () => ({ ...L.normalizeTruth({ pool: "magic", label: "magic", magical: true, detected: false }), tableRef: noun }));
    const out = await Mg.rollMagicTruths({
      truths: placeholders, style: "classic", where: "W.magic", lists: starts, resolve: async () => null,
      roll: (a) => globalThis.acksExtras.magicItems.roll({ ...a, roller: dice }), armsSetting: key, ...seam,
    });
    const stored = out.truths.filter((t) => t.apparent);
    let partsMatch = 0;
    let ranked = 0;
    let weaponTier = 0;
    let armourTier = 0;
    for (const t of stored) {
      const base = await fromUuid(t.apparent.baseUuid);
      const kind = base?.type === "weapon" ? "weapon" : base?.type === "armor" ? (base.system?.type === "shield" ? "shield" : "armor") : null;
      const tier = Mg.ARMS_TIER[kind];
      const add = tier ? W.masterworkFigure(tier)?.costAdd : null;
      if (Number(base?.system?.cost) === t.apparent.baseGp && add === t.apparent.masterworkGp) partsMatch++;
      if (L.rankWorth(t) === t.apparent.baseGp + t.apparent.masterworkGp) ranked++;
      if (kind === "weapon") weaponTier++;
      else if (kind) armourTier++;
    }
    const withoutKey = await Mg.rollMagicTruths({
      truths: placeholders.slice(0, 20), style: "classic", where: "W.magic", lists: starts, resolve: async () => null,
      roll: (a) => globalThis.acksExtras.magicItems.roll({ ...a, roller: dice }), armsSetting: "", ...seam,
    });
    return {
      rolled: out.truths.length, refused: out.errors.length, stored: stored.length, partsMatch, ranked, weaponTier, armourTier,
      bases: seam.bases.length, tierDocs: !!W.masterworkFigure("weaponBoth") && !!W.masterworkFigure("armorAC"),
      blankStores: withoutKey.truths.filter((t) => t.apparent).length,
      unknownKept: stored.every((t) => t.magical && t.detected === false && t.identified === "none"),
    };
  },
  /** Open a staged pot to the table; the doorway message id comes back for the sweep. */
  openIt: async ({ mod, potId }) => {
    const Pm = await import(`${mod}/treasure/pot.mjs`);
    const pile = game.cards.get(potId);
    const r = await Pm.openPot(pile);
    const door = game.messages.filter((m) => m.flags?.["acks-extras"]?.treasure?.uuid === pile.uuid).map((m) => m.id);
    const L = await import(`${mod}/treasure/pot-logic.mjs`);
    const view = Pm.viewOf(pile);
    const byId = new Map(view.cards.map((c) => [c.id, c]));
    const placed = view.pot.order.map((id) => byId.get(id)).filter(Boolean);
    const expected = L.bandsOf(placed.map((c) => L.rankWorth(c.truth)));
    const bandsMatch = placed.length > 0 && placed.every((c, i) => c.value === expected[i]);
    return { ok: !!r?.ok, reason: r?.reason ?? null, door, left: view.cards.length, magicLeft: view.cards.filter((c) => c.truth.pool === "magic").length, phase: view.pot.phase, bandsMatch, placed: placed.length };
  },
  /** The Player seat's turned faces of the given cards, read as its window prints them: whether any names its item. */
  playerFaces: async ({ mod, potId, ids }) => {
    const Pm = await import(`${mod}/treasure/pot.mjs`);
    const L = await import(`${mod}/treasure/pot-logic.mjs`);
    const pile = game.cards.get(potId);
    const cards = Pm.viewOf(pile).cards.filter((c) => ids.includes(c.id));
    const views = cards.map((c) => ({ v: L.cardView(c, { isGM: false }), label: c.truth.label }));
    return { cards: cards.length, turned: views.filter(({ v }) => v.name).length, named: views.filter(({ v, label }) => v.name === label).length, aura: views.filter(({ v }) => v.aura).length };
  },
};

const made = [];
let gm = null;
let player = null;
watchdog(() => [gm, player]);
try {
  section("seats");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  await openSeats({ gm, player, blocked, pattern: /treasure|pot-sheet|deal|hoard|magic-items/i });

  section("registries");
  const pr = await run(gm, P.probe, { mod: MOD });
  if (!pr.treasure) blocked("the world's treasure registry is not imported; import the Treasure Tome first");
  if (!pr.lists.classic) blocked("the world's item tables are not imported (no classic list to begin a roll at)");
  note("census: every treasure type's magic placeholders, by match outcome", pr.census);
  check("both registries are imported", pr.treasure && pr.lists.classic > 0, { lists: pr.lists, tried: pr.tried });
  check("the real hoard nouns meet the real list captions: some classic placeholder names a list", pr.census.classic.matched > 0, pr.census.classic);
  if (pr.lists.heroic) check("every heroic placeholder names a rarity list", pr.census.heroic.placeholders > 0 && pr.census.heroic.matched === pr.census.heroic.placeholders, pr.census.heroic);
  if (!pr.letter.classic) blocked("no classic treasure type deals a magic placeholder that names a list");

  section("Step 8. classic deal");
  const c = await run(gm, P.deal, { mod: MOD, letter: pr.letter.classic, style: "classic" });
  if (c.uuid) made.push(gm.track(c.uuid, "Cards"));
  note("classic: refusal codes of cards left a placeholder", c.reasons);
  check("a placeholder that names a list is rolled, not left a placeholder", c.ok && c.rolled > 0, { magic: c.magic, rolled: c.rolled, reasons: c.reasons.length });
  check("every magic card is rolled or carries a refusal code; none vanished", c.magic === c.rolled + c.reasons.length, { magic: c.magic, rolled: c.rolled, refused: c.reasons.length });
  check("the deal's result carries an audit row for each die the magic rolls threw, begun at a classic list", c.audit > 0 && c.starts.every((s) => s === "classic" || s === "classicType"), { rows: c.audit, starts: c.starts });
  check("each rolled card is stored magic, undetected and unidentified", c.unknown);
  check("no rolled card's turned face reads its item's name, even on the Judge's own reading of the face", c.judgeHidden);
  if (c.linked) check("a rolled card linked to a document claims as it with no identification, no curse known, marked magic and wearing what it passed for", c.claimKnowsNothing === true);
  else note("classic: no rolled card linked to a document, so the claim half is not reached", { linked: 0 });

  section("Step 8. the Player seat turns them");
  const o = await run(gm, P.openIt, { mod: MOD, potId: c.potId });
  for (const id of o.door) made.push(gm.track(id, "ChatMessage"));
  check("the pot opens to the table", o.ok && o.phase === "open", { phase: o.phase, reason: o.reason });
  check("a rolled card linked to a document carries the apparent value its entry prints, and ranks by it, not at nothing", c.apparentCarried > 0 && c.apparentRanked === c.apparentCarried, { linked: c.linked, carried: c.apparentCarried, ranked: c.apparentRanked });
  check("every card's band in the opened pot is the band of its rank worth among the pot's cards", o.bandsMatch, { placed: o.placed });
  for (const cardId of c.rolledIds) await run(player, K.relay, { potId: c.potId, op: "flip", cardId });
  const f = await run(player, P.playerFaces, { mod: MOD, potId: c.potId, ids: c.rolledIds });
  check("the Player seat turned every rolled card, and no turned face names its item or shows an aura", f.cards > 0 && f.cards === c.rolledIds.length && f.turned === f.cards && f.named === 0 && f.aura === 0, f);

  section("Step 8. heroic deal");
  if (pr.lists.heroic && pr.letter.heroic) {
    const h = await run(gm, P.deal, { mod: MOD, letter: pr.letter.heroic, style: "heroic" });
    if (h.uuid) made.push(gm.track(h.uuid, "Cards"));
    note("heroic: refusal codes of cards left a placeholder", h.reasons);
    check("a heroic deal rolls on the rarity lists", h.ok && h.rolled > 0 && h.starts.length > 0 && h.starts.every((s) => s === "heroic"), { rolled: h.rolled, starts: h.starts, refused: h.reasons.length });
  } else check("a heroic treasure type deals a placeholder that names a rarity list", false, { lists: pr.lists, letter: !!pr.letter.heroic });

  section("Step 8. No magic");
  const nb = await run(gm, P.deal, { mod: MOD, letter: pr.letter.classic, style: "classic", noMagic: "before" });
  if (nb.uuid) made.push(gm.track(nb.uuid, "Cards"));
  check("with No magic on before the deal, the hoard deals no magic card, so nothing is rolled or refused", nb.ok && nb.magic === 0 && nb.rolled === 0 && nb.reasons.length === 0 && nb.audit === 0, { magic: nb.magic, rolled: nb.rolled, refused: nb.reasons.length, audit: nb.audit });
  const n = await run(gm, P.deal, { mod: MOD, letter: pr.letter.classic, style: "classic", noMagic: "after" });
  if (n.uuid) made.push(gm.track(n.uuid, "Cards"));
  const no = await run(gm, P.openIt, { mod: MOD, potId: n.potId });
  for (const id of no.door) made.push(gm.track(id, "ChatMessage"));
  check("with No magic turned on after the deal, the rolled cards are struck when the pot opens", n.rolled > 0 && no.ok && no.magicLeft === 0, { rolled: n.rolled, magicLeft: no.magicLeft });

  section("Step 8. the arms column and an arm's apparent worth");
  const col = await run(gm, P.column, { mod: MOD, key: "s1" });
  for (const uuid of col.uuids ?? []) made.push(gm.track(uuid, "Cards"));
  check("the pot's column is set by API, refuses a value that is no column, is the next new pot's default, and clears", col.made && col.set && col.refused && col.inherited && col.cleared && col.valid, col);
  const a = await run(gm, P.arms, { mod: MOD, key: "s1" });
  if (a.noList) blocked("no classic list names weapons, so no arm can be rolled");
  note("arms: sixty rolls on the weapons list", a);
  if (!a.bases) blocked("no minted weapon or armour document is in the library; import the equipment tables first");
  if (!a.tierDocs) note("arms: the masterwork tier documents are not imported, so a card stores nothing and ranks 0", { stored: a.stored });
  check("the roll with the column set stores no card that is not undetected, unidentified magic", a.unknownKept);
  check("a blank column stores no figures on a weapons-list card (each links a grid or the weapon-kind list, so needs a type)", a.blankStores === 0, { blank: a.blankStores });
  if (a.tierDocs) {
    check("some rolled arm stored its base and masterwork figures", a.stored > 0, { stored: a.stored, rolled: a.rolled, refused: a.refused });
    check("every stored base cost is its document's own cost and every masterwork cost is its kind's tier `costAdd`", a.stored > 0 && a.partsMatch === a.stored, { stored: a.stored, matched: a.partsMatch });
    check("every such card ranks at the sum of its two parts", a.stored > 0 && a.ranked === a.stored, { stored: a.stored, ranked: a.ranked });
  }

  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  for (const [key, api] of [["player", player], ["gm", gm]]) {
    if (!api) continue;
    try { await run(api, K.closeAll); } catch {}
    try { note(`restored (${key})`, await run(api, K.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  }
  if (gm) {
    try { note("swept (the run's own ids)", await gm.sweepTracked({ only: made.filter((uuid) => gm.tracked().some((e) => e.uuid === uuid)) })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  finish();
}
