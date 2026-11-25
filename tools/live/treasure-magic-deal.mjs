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
 * deal rolling on the rarity lists; a gritty deal of a type whose magic cell
 * the engine reads in part (a clause refused alone, the others dealt): magic in
 * the pot, and the failed clause reported once per hoard by its code, not the
 * whole cell refused; No magic striking rolled cards at open; the
 * pot's arms column set by API (`setDealOption`, T6c-2) and
 * sixty rolls on the weapons list, each stored arm's base cost checked against
 * its document and its masterwork cost against the tier's `costAdd`, ranking at
 * their sum; the deal panel's "Arms and armor column" select (T6c-3) read in the
 * Judge's window (placement, label, options against the import, the pick kept
 * on the pot and as the next pot's default, its tooltip), a typed arm's card
 * (its "Undetected · rolled" line and its band's tooltip) and the Player seat's
 * window, which has none of it. The pick is a scripted change event, since the
 * native list is an operating-system popup the page cannot press; the disabled
 * state (no arms grid imported) is read only in a world without the grids.
 * Needs the equipment tables and the masterwork documents imported,
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
  /**
   * The gritty type whose magic cell the engine reads in part: `parseCell` returns terms and errors both. Counts by
   * outcome come back (cells that read clean, in part, and not at all), with the failed clauses' codes; no clause
   * text, count or noun leaves the page.
   */
  grittyPick: async ({ mod }) => {
    const T = await import(`${mod}/lib/tables.mjs`);
    const B = await import(`${mod}/importer/treasure-binding.mjs`);
    const HL = await import(`${mod}/treasure/hoard-logic.mjs`);
    const rows = T.hasDoc(B.TREASURE_DOC_ID) ? T.getDoc(B.TREASURE_DOC_ID).tables?.typeGritty ?? {} : {};
    const cells = { clean: 0, partial: 0, refused: 0 };
    let letter = null;
    let codes = [];
    for (const key of Object.keys(rows)) {
      const parsed = HL.parseCell(rows[key]?.magic, { column: "magic" });
      if (parsed.error) cells.refused++;
      else if (parsed.terms?.length && parsed.errors?.length) {
        cells.partial++;
        if (!letter) { letter = key; codes = parsed.errors.map((e) => e.code); }
      } else if (parsed.terms?.length) cells.clean++;
    }
    // A cell refused whole while one of its clauses reads on its own is the whole-cell refusal a partial cell must
    // not get. The split is the engine's own clause separator, read here so the census does not trust parseCell's
    // aggregation to report on itself; every grid and every dealt column is counted (the engine's label columns,
    // which it never deals, are skipped as it skips them).
    const SPLIT = /\s*(?:;|,(?=\s+\d)|\s\+\s)\s*/;
    const LABELS = new Set(["category", "avgValue"]);
    let wholeButReadable = 0;
    let wholeCells = 0;
    const tables = T.hasDoc(B.TREASURE_DOC_ID) ? T.getDoc(B.TREASURE_DOC_ID).tables ?? {} : {};
    for (const grid of ["typeClassic", "typeHeroic", "typeGritty"]) {
      for (const row of Object.values(tables[grid] ?? {})) {
        for (const [column, cell] of Object.entries(row ?? {})) {
          if (LABELS.has(column) || typeof cell !== "string" || !HL.parseCell(cell, { column }).error) continue;
          wholeCells++;
          if (cell.split(SPLIT).some((part) => part && HL.parseCell(part, { column }).terms?.length)) wholeButReadable++;
        }
      }
    }
    return { types: Object.keys(rows).length, cells, letter, codes, wholeCells, wholeButReadable };
  },
  /**
   * `hoards` hoards of `letter` dealt in gritty into a fresh pot staged By hand, the die at its floor so every chance
   * clause hits. `once` is whether each hoard reports the cell's failed clauses exactly once each, by their codes
   * (`codes`, in `parseCell`'s order), at the magic column; `whole` counts errors there that carry no clause but
   * a code of the same set, which is the whole cell refused.
   */
  grittyDeal: async ({ mod, letter, hoards, codes }) => {
    const D = await import(`${mod}/treasure/deal.mjs`);
    const Pm = await import(`${mod}/treasure/pot.mjs`);
    const pile = await globalThis.acksExtras.treasure.newDealPot([]);
    if (!pile) return { made: false };
    const orig = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => 0;
    let out;
    try {
      out = await D.dealLettersIntoPot(pile, { letters: Array(hoards).fill(letter), style: "gritty", confirmLair: async () => true });
    } finally {
      CONFIG.Dice.randomUniform = orig;
    }
    const truths = Pm.viewOf(pile).cards.map((c) => c.truth);
    const dealt = out?.dealt ?? [];
    const atMagic = (d) => (d.errors ?? []).filter((e) => String(e.where ?? "").endsWith(".magic"));
    const want = [...codes].sort().join("|");
    return {
      made: true,
      uuid: pile.uuid,
      ok: !!out?.ok,
      hoards: dealt.length,
      magic: truths.filter((x) => x.pool === "magic").length,
      once: dealt.length === hoards && dealt.every((d) => atMagic(d).filter((e) => e.clause != null).map((e) => e.code).sort().join("|") === want),
      whole: dealt.reduce((n, d) => n + atMagic(d).filter((e) => e.clause == null && codes.includes(e.code)).length, 0),
    };
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
   * The pot's arms column, set by API: read back on the pot,
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
  /**
   * The deal panel's arms column field on the Judge's window of `potId`, read as the DOM has it: whether it is
   * there, labelled, described and placed under Table style, what its options are against the import, which one
   * is selected, whether it is disabled, and what its tooltip names. Booleans and counts only.
   */
  armsField: async ({ mod, potId }) => {
    const H = globalThis.__tk;
    const D = await import(`${mod}/treasure/deal.mjs`);
    const Pm = await import(`${mod}/treasure/pot.mjs`);
    const root = H.root(H.sheet(potId));
    const select = root?.querySelector("[data-deal-arms]") ?? null;
    if (!select) return { found: false };
    const src = D.armsSource();
    const options = [...select.options];
    const label = root.querySelector(`label[for="${CSS.escape(select.id)}"]`);
    const describedBy = select.getAttribute("aria-describedby");
    const hint = describedBy ? root.querySelector(`#${CSS.escape(describedBy)}`) : null;
    const wrap = select.closest("[data-tooltip-text]");
    const field = select.closest(".acks-extras-treasure__field");
    const styles = root.querySelector("[data-action='dealStyle']")?.closest("fieldset");
    const stored = Pm.potOf(H.pile(potId)).deal.armsSetting;
    const chosen = options.find((o) => o.selected) ?? null;
    return {
      found: true,
      hasId: !!select.id && root.querySelectorAll(`#${CSS.escape(select.id)}`).length === 1,
      labelled: !!label && H.text(label) === H.t("deal.armsTitle"),
      hinted: !!hint && H.text(hint) === H.t("deal.armsHint"),
      underStyle: !!styles && styles.nextElementSibling === field,
      noneFirst: options[0]?.value === "" && options[0]?.textContent.trim() === H.t("deal.armsNone"),
      columns: src.columns.length,
      optionsMatch: options.length === src.columns.length + 1 && src.columns.every((c, i) => options[i + 1]?.value === c.key && options[i + 1]?.textContent.trim() === c.label),
      disabled: select.disabled,
      selectedKey: chosen?.value ?? null,
      selectedIsStored: (chosen?.value ?? "") === (src.columns.some((c) => c.key === stored) ? stored : ""),
      tipNamesColumn: !!chosen?.value && (wrap?.getAttribute("data-tooltip-text") ?? "").includes(chosen.textContent.trim()),
      tipNamesPage: (wrap?.getAttribute("data-tooltip-text") ?? "").includes(src.cite ?? H.t("cite.arms")),
      tipPageOnly: (wrap?.getAttribute("data-tooltip-text") ?? "") === (src.cite ?? H.t("cite.arms")),
      noTitle: !select.hasAttribute("title") && !wrap?.hasAttribute("title"),
    };
  },
  /**
   * Pick the column at option `index` the way a change event does (the native list is an operating-system
   * popup the page cannot press), wait for the write and the re-render, and read the pot, the window and the
   * Judge's remembered default back.
   */
  armsPick: async ({ mod, potId, index }) => {
    const H = globalThis.__tk;
    const Pm = await import(`${mod}/treasure/pot.mjs`);
    const select = () => H.root(H.sheet(potId))?.querySelector("[data-deal-arms]") ?? null;
    const first = select();
    const option = first?.options[index] ?? null;
    if (!option) return { picked: false };
    H.armsFlag ??= game.user.getFlag("acks-extras", "treasureArms") ?? "";
    const key = option.value;
    const text = option.textContent.trim();
    first.value = key;
    first.dispatchEvent(new Event("change", { bubbles: true }));
    const wrote = await H.poll(() => Pm.potOf(H.pile(potId)).deal.armsSetting === key, { tries: 40, every: 200 });
    await H.sleep(600);
    const after = select();
    const wrap = after?.closest("[data-tooltip-text]");
    return {
      picked: true,
      key,
      stored: !!wrote,
      remembered: (game.user.getFlag("acks-extras", "treasureArms") ?? "") === key,
      reselected: after?.value === key,
      tipNamesColumn: (wrap?.getAttribute("data-tooltip-text") ?? "").includes(text),
    };
  },
  /**
   * With `clear`, blank the Judge's remembered arms column so a new pot opens with none (the value found is
   * kept for the restore); without it, put the column back as it was found.
   */
  armsRestore: async ({ clear = false } = {}) => {
    const H = globalThis.__tk;
    H.armsFlag ??= game.user.getFlag("acks-extras", "treasureArms") ?? "";
    if (!clear && H.armsFlag) await game.user.setFlag("acks-extras", "treasureArms", H.armsFlag);
    else await game.user.unsetFlag("acks-extras", "treasureArms");
    if (!clear) H.armsFlag = undefined;
    return { restored: !clear };
  },
  /**
   * Stage one typed arm in `potId` (a roll on the weapons list with the column `key` until one is typed, no
   * more than sixty), render the Judge's window, and read its card: the line naming the type, and the band's
   * tooltip carrying the parts and pages. The type itself comes back for the Player seat's leak check and is
   * never printed.
   */
  armsCard: async ({ mod, potId, key }) => {
    const H = globalThis.__tk;
    const Mg = await import(`${mod}/treasure/magic-deal-logic.mjs`);
    const D = await import(`${mod}/treasure/deal.mjs`);
    const L = await import(`${mod}/treasure/pot-logic.mjs`);
    const Pm = await import(`${mod}/treasure/pot.mjs`);
    const starts = globalThis.acksExtras.magicItems.starts();
    const noun = starts?.classic?.find((e) => /weapon/i.test(`${e.key} ${e.caption}`))?.caption ?? null;
    if (!noun) return { noList: true };
    const seam = await D.armsSeam();
    const dice = (expr) => { const sides = Number(String(expr).slice(String(expr).indexOf("d") + 1)); return { total: 1 + Math.floor(Math.random() * sides), sides }; };
    let typed = null;
    for (let n = 0; n < 60 && !typed; n++) {
      const out = await Mg.rollMagicTruths({
        truths: [{ ...L.normalizeTruth({ pool: "magic", label: "magic", magical: true, detected: false }), tableRef: noun }],
        style: "classic", where: "W.magic", lists: starts, resolve: async () => null,
        roll: (a) => globalThis.acksExtras.magicItems.roll({ ...a, roller: dice }), armsSetting: key, ...seam,
      });
      typed = out.truths.find((t) => t.apparent?.type) ?? null;
    }
    if (!typed) return { typed: false };
    const pile = H.pile(potId);
    await Pm.addTruths(pile, [typed]);
    await H.sheet(potId).render();
    const card = Pm.viewOf(pile).cards.find((c) => c.truth.apparent?.type);
    const li = await H.poll(() => H.root(H.sheet(potId))?.querySelector(`li[data-card-id="${card?.id}"]`) ?? null, { tries: 40, every: 250 });
    if (!li) return { typed: true, found: false };
    const pips = li.querySelector(".acks-extras-treasure__pips");
    const tip = pips?.getAttribute("data-tooltip-text") ?? "";
    const { type, baseGp, masterworkGp } = typed.apparent;
    const gp = (n) => (Math.round(n * 100) / 100).toLocaleString(game.i18n.lang);
    const bandName = pips?.getAttribute("aria-label") ?? "";
    return {
      typed: true,
      found: true,
      type,
      line: [...li.querySelectorAll(".acks-extras-treasure-card__note")].some((n) => H.text(n) === H.t("card.rolledType", { type })),
      tipKeepsBand: tip.startsWith(H.t("tip.band", { band: bandName })),
      tipParts: tip.includes(type) && tip.includes(`${gp(baseGp)} gp`) && tip.includes(`${gp(masterworkGp)} gp`) && tip.includes(H.t("cite.masterwork")),
      tipPage: tip.endsWith(H.t("cite.arms")),
      noTitle: !li.querySelector("[title]"),
      ranks: L.rankWorth(L.normalizeTruth(typed)) === baseGp + masterworkGp,
    };
  },
  /** The Player seat's window of `potId`: no deal panel, no arms field, and none of the Judge's types in its text or tooltips. */
  armsPlayer: async ({ potId, types }) => {
    const H = globalThis.__tk;
    const pile = H.pile(potId);
    if (!pile) return { rendered: false };
    await pile.sheet.render(true);
    const root = await H.poll(() => { const r = H.root(pile.sheet); return pile.sheet.rendered && r?.querySelector("li[data-card-id], .acks-extras-treasure__empty") ? r : null; }, { tries: 40, every: 250 });
    if (!root) return { rendered: false };
    if (!H.opened.includes(pile.sheet)) H.opened.push(pile.sheet);
    const all = H.text(root) + " " + [...root.querySelectorAll("[data-tooltip-text],[aria-label]")].map((e) => `${e.getAttribute("data-tooltip-text") ?? ""} ${e.getAttribute("aria-label") ?? ""}`).join(" ");
    return {
      rendered: true,
      field: !!root.querySelector("[data-deal-arms]"),
      panel: !!root.querySelector(".acks-extras-treasure__side"),
      leaks: (types ?? []).filter((x) => all.includes(x)).length,
      rolledLine: all.includes(H.t("card.rolledType", { type: "" }).trim()),
      masterworkTip: all.includes(H.t("cite.masterwork")),
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

  section("Step 8. gritty deal, a magic cell with a clause that fails");
  const gp = await run(gm, P.grittyPick, { mod: MOD });
  check("no cell of the three type grids is refused whole while one of its clauses reads on its own", gp.wholeButReadable === 0, { refusedWhole: gp.wholeCells, withAReadableClause: gp.wholeButReadable });
  if (gp.types) note("gritty: the imported magic cells, by how the engine reads them", { types: gp.types, ...gp.cells });
  if (!gp.types) note("gritty: the gritty type table is not imported, so the failed-clause deal is not reached", { types: 0 });
  else if (!gp.letter) note("gritty: no type's magic cell reads in part (some clauses dealt, one refused alone), so the failed-clause deal is not reached", gp.cells);
  const g = gp.letter ? await run(gm, P.grittyDeal, { mod: MOD, letter: gp.letter, hoards: 3, codes: gp.codes }) : null;
  if (g?.uuid) made.push(gm.track(g.uuid, "Cards"));
  if (g) note("gritty: the failed clauses' codes, one cell", gp.codes);
  if (g) check("a gritty hoard whose magic cell has a clause that fails still deals the others: magic placeholders or rolled magic cards are in the pot", g.made && g.ok && g.magic > 0, { magic: g.magic, hoards: g.hoards });
  if (g) check("each of the three hoards reports the failed clause once, by its code at the magic column, and none reports the whole cell refused", g.made && g.once && g.whole === 0, { once: g.once, whole: g.whole, hoards: g.hoards });
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

  section("Step 8. the arms column in the deal panel (T6c-3)");
  await run(gm, P.armsRestore, { clear: true });
  const potU = await run(gm, K.newPot);
  if (!potU) blocked("a new pot did not open a window to walk the arms field in");
  made.push(gm.track(potU.uuid, "Cards"));
  const f0 = await run(gm, P.armsField, { mod: MOD, potId: potU.potId });
  check("State A. a new pot's panel has the field under Table style, labelled, described, with its own id once, and \"(none)\" first", f0.found && f0.hasId && f0.labelled && f0.hinted && f0.underStyle && f0.noneFirst, f0);
  if (!f0.columns) {
    check("State C. no arms grid imported: the field is disabled, holds (none) alone, and its tooltip is the page reference alone", f0.disabled && f0.optionsMatch && f0.selectedKey === "" && f0.tipPageOnly && f0.noTitle, f0);
    blocked("the Tome's arms grids are not imported, so no column can be picked; re-import the item tables");
  }
  check("the options are \"(none)\" and one per imported column, in the import's own labels and order", f0.optionsMatch && !f0.disabled, { columns: f0.columns });
  check("State A. nothing is picked on a new pot, and the tooltip is the page reference alone", f0.selectedKey === "" && f0.selectedIsStored && f0.tipPageOnly, f0);
  const pick = await run(gm, P.armsPick, { mod: MOD, potId: potU.potId, index: 1 });
  check("State B. picking a column keeps it on the pot and as the Judge's next-pot default, and the window shows it selected", pick.picked && pick.stored && pick.remembered && pick.reselected, pick);
  check("State B. the selected option's tooltip names the column and the page", pick.tipNamesColumn, { column: pick.tipNamesColumn });
  const f1 = await run(gm, P.armsField, { mod: MOD, potId: potU.potId });
  check("the field reads back the stored column after a re-render", f1.selectedKey === pick.key && f1.selectedIsStored && f1.tipNamesColumn && f1.tipNamesPage && f1.noTitle, { selected: f1.selectedKey === pick.key });
  const potV = await run(gm, K.newPot);
  if (potV) made.push(gm.track(potV.uuid, "Cards"));
  const f2 = potV ? await run(gm, P.armsField, { mod: MOD, potId: potV.potId }) : { found: false };
  check("a second new pot opens with the remembered column selected", f2.found && f2.selectedKey === pick.key && f2.selectedIsStored, { selected: f2.selectedKey === pick.key });
  const none = await run(gm, P.armsPick, { mod: MOD, potId: potU.potId, index: 0 });
  check("picking \"(none)\" clears the pot's column and the remembered default", none.picked && none.stored && none.remembered && none.reselected, none);
  await run(gm, P.armsRestore);

  const card = await run(gm, P.armsCard, { mod: MOD, potId: potU.potId, key: pick.key });
  if (card.noList) blocked("no classic list names weapons, so no arm can be rolled");
  check("a typed undetected arm is staged for the card walk", card.typed && card.found, { typed: card.typed, found: card.found });
  check("the Judge's card says \"Undetected · rolled: <type>\" on its line", card.line === true);
  check("its band's tooltip is the band's own, then the type, the base and masterwork costs, and the pages", card.tipKeepsBand && card.tipParts && card.tipPage && card.noTitle, { band: card.tipKeepsBand, parts: card.tipParts, page: card.tipPage });
  check("the card ranks at the sum the tooltip names", card.ranks === true);
  const opened = await run(gm, P.openIt, { mod: MOD, potId: potU.potId });
  for (const id of opened.door) made.push(gm.track(id, "ChatMessage"));
  const seen = await run(player, P.armsPlayer, { potId: potU.potId, types: card.type ? [card.type] : [] });
  check("the Player seat's window has no deal panel and no arms field, and shows none of the type, the line or the parts", opened.ok && seen.rendered && !seen.field && !seen.panel && seen.leaks === 0 && !seen.rolledLine && !seen.masterworkTip, seen);

  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  for (const [key, api] of [["player", player], ["gm", gm]]) {
    if (!api) continue;
    if (key === "gm") try { await run(api, P.armsRestore); } catch {}
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
