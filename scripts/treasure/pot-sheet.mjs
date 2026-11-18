/* global game, foundry, fromUuid, ui */
/**
 * The pot's window: the stash a table turns over, and the Judge's staging room
 * for the same pile. One sheet serves both seats and re-renders whenever a Card
 * or the pile changes, so its part root scrolls and core restores the position
 * (`scrollable: [""]`).
 *
 * A player's view is built by `cardView`, which carries nothing the seat may
 * not be told; this file only words it. Every act a seat makes (turn a card,
 * take one) is a request to the relay (`pot-relay.mjs`), never a write.
 * Judge-only acts (dropping cards, buckets, mode, opening, closing) are direct
 * writes and are refused to anyone else in `pot.mjs`.
 */
import { makeLoc } from "../lib/util.mjs";
import { listsGoods } from "../lib/bundles.mjs";
import { providers } from "../lib/storage.mjs";
import { executeAsGM } from "../lib/sockets.mjs";
import { writeOnChange } from "../lib/press-safe-change.mjs";
import { BAND_COUNT, BUCKET, LANG, MODE, MODULE_ID, PHASE, POOL, POT_HANDLER, REFUSAL } from "./constants.mjs";
import { DEAL_STYLE, DEAL_TOGGLE, apparentName, bucketCards, cardInPot, cardView, dealOf, haulOf, normalizeTruth, potCards, turnedOf, withBands } from "./pot-logic.mjs";
import { slowestSpeed, speedOfRank } from "./grab-pot.mjs";
import { TEXTURE, backArt, backDress, faceArt, faceDress, textureArt } from "./card-art.mjs";
import { dealLines, dealMessages, lairWarning } from "./deal-logic.mjs";
import { dealLettersIntoPot } from "./deal.mjs";
import { styleCite } from "./hoard.mjs";
import {
  addTruths, closePot, mayGrab, openPot, partyFigures, potOf, removeStaged, setDealMetInLair, setDealMonsterOn, setDealOption, setDealToggle, setMode, truthsFromItem, viewOf,
} from "./pot.mjs";

const { HandlebarsApplicationMixin, DocumentSheetV2, DialogV2 } = foundry.applications.api;
const loc = makeLoc(LANG);

/** The classes every dialog this feature opens names: the module's own, and the scroll contract. */
const DIALOG_CLASSES = ["acks-ui", "acks", "acks-extras", "acks-extras-scroll", "acks-extras-treasure-dialog"];

/** A gp figure to the copper, without a trailing zero. */
const gpText = (gp) => (Math.round(gp * 100) / 100).toLocaleString(game.i18n.lang);
/** A card's true name (the Judge's own view), or empty where no Card answers. */
const bucketNameOf = (view, id) => view.cards.find((c) => c.id === id)?.truth.label ?? "";

/** A weight in sixths of a stone, as the stones it is. */
const stoneText = (w6) => loc("card.weight", { n: Math.round((w6 / 6) * 10) / 10 });

/** A weight in sixths of a stone as a figure in stone, one decimal at most. */
const stoneFigure = (w6) => Math.round((w6 / 6) * 10) / 10;

/**
 * A refusal said to the seat that asked, or a Judge's warning that went
 * through. No answer is said nothing: `executeAsGM` has already told the seat
 * that no Judge is connected.
 */
export function report(result) {
  if (!result) return;
  if (!result.ok) ui.notifications?.warn(loc(`refuse.${result.reason ?? REFUSAL.failed}`));
  else if (result.warn) ui.notifications?.warn(loc("refuse.judgeGave"));
}

/** What a Quick grab did: the pace the party now keeps, the cards that fit nobody and the members who took nothing. */
function reportGrab(result) {
  if (!result?.ok) return report(result);
  ui.notifications?.info(loc("grab.done", { n: result.placed, speed: result.speed ?? "—" }));
  if (result.leftover.length) ui.notifications?.warn(loc("grab.leftover", { names: result.leftover.map((l) => l.name).join(", ") }));
  if (result.excluded.length) {
    const who = result.excluded.map((e) => loc("grab.excluded", { name: e.name, why: loc(`grab.why.${e.why}`) })).join(", ");
    ui.notifications?.warn(loc("grab.takesNothing", { who }));
  }
}

/** The pot's window. Chosen per pot by `flags.core.sheetClass`; never the default sheet for a pile. */
export default class PotSheet extends HandlebarsApplicationMixin(DocumentSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["acks-ui", "acks", "acks-extras", "acks-extras-scroll", "acks-extras-treasure"],
    tag: "div",
    position: { width: 940, height: 640 },
    window: { icon: "fa-solid fa-gem", resizable: true },
    actions: {
      flip: PotSheet.#onFlip,
      take: PotSheet.#onTake,
      grab: PotSheet.#onGrab,
      setMode: PotSheet.#onSetMode,
      toggleDeal: PotSheet.#onToggleDeal,
      dealMonster: PotSheet.#onDealMonster,
      dealStyle: PotSheet.#onDealStyle,
      dealSpecial: PotSheet.#onDealSpecial,
      dealLair: PotSheet.#onDealLair,
      dealRun: PotSheet.#onDealRun,
      dealConfirm: PotSheet.#onDealConfirm,
      dealCancel: PotSheet.#onDealCancel,
      openTable: PotSheet.#onOpen,
      closePot: PotSheet.#onClose,
      removeCard: PotSheet.#onRemove,
      addValue: PotSheet.#onAddValue,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/treasure/pot.hbs`, scrollable: [""] },
  };

  /** Card ids this window has already shown turned, so a render animates only a card that has just turned. */
  #shown = null;

  /** Whether the lair warning has been asked for by a Deal press and not yet answered; the warning shows only while this holds and the warning still stands. */
  #warned = false;

  /** Whether the next render should put focus on the warning's Deal anyway button, set by the Deal press that raised it. */
  #focusWarning = false;

  /** Whether a Deal is under way, so a second press while the first is rolling does nothing. */
  #dealing = false;

  /** @override A pot is not a form: its seats act through buttons, so core's disabling of a non-owner's controls must not apply. */
  _toggleDisabled() {}

  /** @override */
  get title() {
    return this.document.name;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const isGM = game.user.isGM;
    const view = withBands(viewOf(this.document));
    const { pot } = view;
    const staging = pot.phase === PHASE.staging;
    const open = pot.phase === PHASE.open;
    const seat = potCards(view).map((c) => cardView(c, { isGM }));
    const table = potCards(view).map((c) => cardView(c, { isGM: false }));
    const deal = staging ? dealOf(view) : null;
    const struck = new Set(deal ? [...deal.removed, ...deal.struck] : []);
    const seeds = [BUCKET.add, BUCKET.replace].flatMap((key) => bucketCards(view, key)).map((c) => cardView(c, { isGM: true }));
    const total = staging ? haulOf([...seat.filter((v) => !struck.has(v.id)), ...seeds.filter((v) => !deal.removed.includes(v.id))], { all: true }) : haulOf(table);
    const cite = loc("cite.haul");
    const { turned, count } = turnedOf(view);

    context.isGM = isGM;
    context.staging = staging;
    context.open = open;
    context.totalText = loc("bar.gp", { gp: gpText(total.totalGp) });
    context.totalTip = total.parts.length
      ? loc("tip.haulParts", { parts: total.parts.map((p) => loc("tip.haulPart", { pool: loc(`pool.${p.poolKey}`), gp: gpText(p.gp) })).join(" · "), cite })
      : loc("tip.haulNone", { cite });
    context.foundText = staging ? loc("bar.staged", { n: count }) : loc(count === 1 ? "bar.foundOne" : "bar.found", { n: count });
    context.foundTip = loc("bar.turned", { turned, count });
    context.bands = Array.from({ length: BAND_COUNT }, (_, rank) => ({ rank, name: loc(`band.${rank}`) }));
    const takenBy = new Map();
    for (const p of deal?.replace ?? []) for (const id of p.struck) takenBy.set(id, bucketNameOf(view, p.seedId));
    context.cards = seat.map((v) => ({
      ...this.#cardContext(v, { open, staging }),
      struck: struck.has(v.id),
      struckText: takenBy.has(v.id) ? loc("card.replacedBy", { name: takenBy.get(v.id) }) : loc("card.struck"),
    }));
    context.toggles = Object.values(DEAL_TOGGLE).map((key) => ({
      key,
      label: loc(`toggle.${key}`),
      hint: loc(`toggle.${key}Hint`),
      pressed: pot.deal.toggles[key],
    }));
    context.deal = staging && isGM ? this.#dealContext(pot) : null;
    context.party = open ? this.#partyContext(view) : null;
    context.modeJudge = pot.mode === MODE.judge;
    context.modeTable = pot.mode === MODE.table;
    context.modeHint = loc(pot.mode === MODE.judge ? "judge.modeJudgeHint" : "judge.modeTableHint");
    context.buckets = [BUCKET.add, BUCKET.replace].map((key) => ({
      key,
      title: loc(`judge.bucket.${key}`),
      hint: loc(`judge.bucket.${key}Hint`),
      drop: loc("judge.bucket.drop"),
      rows: bucketCards(view, key).map((c) => {
        const v = cardView(c, { isGM: true });
        const row = { id: v.id, name: v.name, worthText: this.#worthText(v), removeLabel: loc("card.removeLabel", { name: v.name }) };
        const plan = key === BUCKET.replace ? deal?.replace.find((p) => p.seedId === v.id) : null;
        return plan ? { ...row, ...this.#takesText(view, plan) } : row;
      }),
    }));
    return context;
  }

  /**
   * The Judge's deal controls as the template reads them: the staged monster
   * rows, the by-hand letter, the table style and the two toggles, each with the
   * provenance of its figure, and the lair warning while one stands. A row with
   * no letter is disabled, and its tooltip says so with the page reference alone.
   */
  #dealContext(pot) {
    const { deal } = pot;
    const cite = loc("cite.deal");
    const monsters = deal.monsters.map((row, index) => ({
      index,
      on: row.on,
      off: !row.letter,
      name: loc("deal.monster", { name: row.name, count: row.count }),
      countTip: loc("deal.tip.count", { count: row.count }),
      letterText: row.letter ? loc("search.letter", { letter: row.letter }) : loc("deal.noLetter"),
      tip: row.letter ? loc("deal.tip.letter", { name: row.name, letter: row.letter, cite }) : loc("deal.tip.noLetter", { name: row.name, cite }),
    }));
    const styles = DEAL_STYLE.map((key) => {
      const label = loc(`deal.style.${key}`);
      const page = styleCite(key);
      // No page is named while the table is not imported: the module ships no citation for a style.
      return { key, label, pressed: deal.style === key, tip: page ? loc("deal.tip.style", { style: label, cite: page }) : loc("deal.tip.styleBare", { style: label }) };
    });
    const lines = dealLines(deal);
    const standing = this.#warned && !!lairWarning({ letters: lines, metInLair: deal.metInLair });
    return {
      monsters,
      letter: deal.letter ?? "",
      letterTip: loc("search.letterTip"),
      styles,
      special: deal.special,
      lair: deal.metInLair,
      lairTip: cite,
      dealTip: loc("deal.tip.deal"),
      warning: standing ? { body: loc("deal.warn.body", { toggle: loc("deal.lair") }), tip: cite } : null,
    };
  }

  /**
   * The party aside as the template reads it: each member's name, speed and
   * load with the provenance of both, the pace the party keeps now, and the
   * cards the last grab left that are still in the pot. A figure the roster or
   * the actor does not give is a dash, and its tooltip is the page reference
   * alone.
   */
  #partyContext(view) {
    const figures = partyFigures(this.document);
    const cite = loc("cite.pace");
    const members = (figures?.members ?? []).map((m) => {
      const speed = speedOfRank(figures.paceWith(m.id, 0));
      const stated = m.hasDocument && m.capacity6 !== null && m.load6 !== null;
      const note = !m.hasDocument ? loc("party.noGoods") : m.casualty ? loc("party.down") : "";
      return {
        name: m.name,
        uuid: m.uuid,
        drop: !!m.uuid,
        counted: m.hasDocument && !m.casualty && speed !== null,
        speed,
        speedText: speed === null ? "—" : loc("party.speed", { n: speed }),
        speedTip: speed === null ? cite : loc("tip.memberSpeed", { name: m.name, n: speed, cite }),
        pct: stated && m.capacity6 > 0 ? Math.min(100, Math.round((m.load6 / m.capacity6) * 100)) : 0,
        over: stated && m.load6 > m.capacity6,
        loadText: stated ? loc("party.load", { load: stoneFigure(m.load6), cap: stoneFigure(m.capacity6), items: m.items ?? 0 }) : "—",
        loadTip: stated ? loc("tip.memberLoad", { name: m.name, load: stoneFigure(m.load6), cap: stoneFigure(m.capacity6), cite }) : cite,
        note,
      };
    });
    const pace = slowestSpeed(members.map((m) => (m.counted ? m.speed : null)));
    const left = (potOf(this.document).grab?.leftover ?? [])
      .map((l) => ({ l, card: cardInPot(view, l.cardId) }))
      .filter(({ card }) => card && card.face !== null && card.face !== undefined && !card.truth.claimedBy)
      .map(({ l, card }) => ({ name: apparentName(card.truth), code: l.code }));
    return {
      members,
      canGrab: mayGrab(this.document, game.user),
      movesText: pace === null ? "—" : loc("party.speed", { n: pace }),
      movesTip: loc("tip.partyMoves", { cite }),
      leftover: left.length ? loc("party.leftover", { names: left.map((x) => x.name).join(", ") }) : "",
      leftoverTip: left.map((x) => loc("tip.leftoverPart", { name: x.name, why: loc(`grab.code.${x.code}`) })).join(" · "),
    };
  }

  /**
   * What a replace seed takes, worded for its bucket row: the lots by their
   * true names and how far they overshoot, with a tooltip of the figures. A seed
   * the lots cannot cover, or one stating no worth, takes none and says so. The
   * planner is the module's own procedure, so the tooltip names its parts and
   * cites no page.
   */
  #takesText(view, plan) {
    if (!plan.ok) {
      const figures = { worth: gpText(plan.worthGp), available: gpText(plan.availableGp) };
      return { takes: loc("bucket.takesShort", { short: gpText(plan.shortGp) }), takesTip: loc("tip.takesShort", figures) };
    }
    if (!plan.struck.length) return { takes: loc("bucket.takesNone"), takesTip: "" };
    const lots = plan.struck.map((id) => bucketNameOf(view, id)).join(", ");
    const figures = { worth: gpText(plan.worthGp), taken: gpText(plan.takenGp), over: gpText(plan.overGp) };
    return { takes: plan.overGp > 0 ? loc("bucket.takesOver", { lots, over: figures.over }) : loc("bucket.takes", { lots }), takesTip: loc("tip.takes", figures) };
  }

  #worthText(v) {
    return v.worthGp == null ? loc("card.worthUnknown") : loc("card.worth", { gp: gpText(v.worthGp) });
  }

  /** One card as the template reads it: the view, worded. */
  #cardContext(v, { open, staging }) {
    const pool = v.look === "cursed" ? loc("card.cursed") : loc(`pool.${v.poolKey}`);
    const backPool = loc(`pool.${v.backKey}`);
    const bandName = loc(`band.${v.band}`);
    return {
      ...v,
      tag: pool,
      band: v.band,
      bandPips: "◆".repeat(v.band + 1),
      bandName,
      bandTip: loc("tip.band", { band: bandName }),
      // A player's tooltip names the displayed pool's page and nothing else, so no card can be told from another by it.
      tip: loc("tip.pool", { pool: backPool, cite: loc(`cite.${v.backKey}`) }),
      backTag: backPool,
      backLabel: loc(v.auraBack ? "card.backLabelAura" : "card.backLabel", { pool: backPool, band: bandName }),
      removeLabel: loc("card.removeLabel", { name: v.name }),
      worthText: this.#worthText(v),
      weightText: v.weight6 ? stoneText(v.weight6) : loc("card.weightless"),
      stateText: loc(v.up ? "card.stateUp" : "card.stateDown"),
      canFlip: open && v.down && !v.claimed,
      canTake: open && v.up && !v.claimed,
      dragUuid: open && v.up && !v.claimed ? (this.document.cards.get(v.id)?.uuid ?? "") : "",
      staging,
      back: this.#withTextures(backDress(v), v.band, backArt(v)),
      face: this.#withTextures(faceDress(v), v.band, faceArt(v)),
    };
  }

  /**
   * A dress with the textures its layers paint: a layer the dress asks for is
   * rendered only where the reader finds a texture for it.
   */
  #withTextures(dress, band, art) {
    const foilKind = dress.foil === "magic" ? TEXTURE.foilMagic : TEXTURE.foil;
    return {
      ...dress,
      art,
      grimeTex: dress.grime ? textureArt(TEXTURE.grime, band) : null,
      foilTex: dress.foil ? textureArt(foilKind, band) : null,
      vignetteTex: dress.vignette ? textureArt(TEXTURE.vignette, band) : null,
    };
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const first = this.#shown === null;
    const seen = new Set();
    for (const el of this.element.querySelectorAll("[data-up]")) {
      const id = el.closest("[data-card-id]")?.dataset.cardId;
      if (!id) continue;
      seen.add(id);
      if (!first && !this.#shown.has(id)) el.classList.add("is-turning");
    }
    this.#shown = seen;
    this.#bindDrops();
    this.#bindChoices();
    if (this.#focusWarning) {
      this.#focusWarning = false;
      this.element.querySelector("[data-deal-warning] [data-action='dealConfirm']")?.focus();
    }
  }

  /**
   * Bound once per window element: the by-hand treasure type is written when its
   * field changes, since a pot is not a form and nothing else stores it. A change
   * made by pressing Deal is written after the press (`writeOnChange`), so the
   * re-render does not swallow Deal's click. The target is told by `matches`,
   * never by `instanceof`.
   */
  #bindChoices() {
    const root = this.element;
    if (root.dataset.choiceBound) return;
    root.dataset.choiceBound = "1";
    writeOnChange(root, (field) => {
      if (field?.matches?.("[data-deal-letter]") && game.user.isGM) setDealOption(this.document, "letter", field.value);
    });
  }

  /**
   * Bound once per window element, on the element itself so a re-render of the
   * part keeps it. A turned card is dragged as a Card; a member's zone takes
   * one (any seat, once the pot is open); the Judge's zones in staging take
   * items. Nodes are told by `closest`, never by `instanceof`.
   */
  #bindDrops() {
    const root = this.element;
    if (root.dataset.dropBound) return;
    root.dataset.dropBound = "1";
    const ZONES = "[data-accept-drop], [data-member-drop]";
    let lit = null;
    const light = (zone) => {
      if (zone === lit) return;
      lit?.classList.remove("is-dropping");
      lit = zone;
      lit?.classList.add("is-dropping");
    };
    root.addEventListener("dragstart", (event) => {
      const el = event.target?.closest?.("[data-drag-uuid]");
      if (!el?.dataset.dragUuid || !event.dataTransfer) return;
      event.dataTransfer.setData("text/plain", JSON.stringify({ type: "Card", uuid: el.dataset.dragUuid }));
      event.dataTransfer.effectAllowed = "move";
    });
    root.addEventListener("dragover", (event) => {
      const zone = event.target.closest?.(ZONES) ?? null;
      if (zone) event.preventDefault();
      light(zone);
    });
    root.addEventListener("dragleave", (event) => {
      if (!root.contains(event.relatedTarget)) light(null);
    });
    root.addEventListener("dragend", () => light(null));
    root.addEventListener("drop", (event) => {
      light(null);
      const zone = event.target.closest?.(ZONES);
      if (!zone) return;
      event.preventDefault();
      if (zone.dataset.memberDrop) this.#onMemberDrop(event, zone.dataset.actorUuid);
      else if (game.user.isGM) this.#onDrop(event, zone.dataset.acceptDrop);
    });
  }

  /** A card dropped on a member's zone: ask the relay to put it on that member's actor. */
  async #onMemberDrop(event, actorUuid) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    const card = data?.type === "Card" && data.uuid ? await fromUuid(data.uuid) : null;
    if (!card || card.parent?.id !== this.document.id) {
      ui.notifications?.warn(loc(`refuse.${REFUSAL.notInPot}`));
      return;
    }
    report(await executeAsGM(POT_HANDLER, { potId: this.document.id, op: "claim", cardId: card.id, actorUuid }));
  }

  /** Items dropped on the pot become cards; on a bucket, seed cards of that bucket. Anything else is said not to be taken. */
  async #onDrop(event, zone) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    const item = data?.type === "Item" && data.uuid ? await fromUuid(data.uuid) : null;
    if (!item) {
      ui.notifications?.warn(loc("refuse.dropKind"));
      return;
    }
    const bucket = zone === BUCKET.add || zone === BUCKET.replace ? zone : null;
    await addTruths(this.document, truthsFromItem(item), { bucket });
  }

  /* -------------------------------------------- */
  /*  Actions                                      */
  /* -------------------------------------------- */

  /** Ask the relay to turn a card. */
  static async #onFlip(_event, target) {
    report(await executeAsGM(POT_HANDLER, { potId: this.document.id, op: "flip", cardId: target.dataset.cardId }));
  }

  /** Pick an actor the seat may give goods to, then ask the relay to put the card on it. */
  static async #onTake(_event, target) {
    const actorUuid = await this.#chooseActor();
    if (!actorUuid) return;
    report(await executeAsGM(POT_HANDLER, { potId: this.document.id, op: "claim", cardId: target.dataset.cardId, actorUuid }));
  }

  /** Ask the relay to share what is turned across the party; it plans again on the Judge's client. */
  static async #onGrab() {
    reportGrab(await executeAsGM(POT_HANDLER, { potId: this.document.id, op: "grab" }));
  }

  /**
   * The actor a Take goes to. A seat that owns one candidate takes it without
   * a question; with several it is asked; a Judge is asked among every actor
   * that carries goods. Null when cancelled or when the seat owns none.
   */
  async #chooseActor() {
    const mine = game.actors.filter((a) => a.isOwner && listsGoods(a));
    if (!mine.length) {
      ui.notifications?.warn(loc("refuse.noActor"));
      return null;
    }
    if (mine.length === 1 && !game.user.isGM) return mine[0].uuid;
    const esc = foundry.utils.escapeHTML;
    const options = mine.map((a) => `<option value="${esc(a.uuid)}">${esc(a.name)}</option>`).join("");
    return DialogV2.prompt({
      classes: DIALOG_CLASSES,
      window: { title: loc("take.title"), icon: "fa-solid fa-hand" },
      content: `<label>${esc(loc("take.to"))} <select name="actor">${options}</select></label>`,
      ok: { label: loc("card.take"), callback: (_event, button) => button.form.elements.actor.value },
      rejectClose: false,
    });
  }

  /** Judge: who rolls. */
  static async #onSetMode(_event, target) {
    await setMode(this.document, target.dataset.mode === MODE.table ? MODE.table : MODE.judge);
  }

  /** Judge: set or clear one deal toggle on the staged pot. */
  static async #onToggleDeal(_event, target) {
    await setDealToggle(this.document, target.dataset.toggle, target.getAttribute("aria-pressed") !== "true");
  }

  /** Judge: tick or clear one monster row; a refused write leaves the box as the pot has it. */
  static async #onDealMonster(_event, target) {
    const written = await setDealMonsterOn(this.document, Number(target.dataset.index), !!target.checked);
    if (!written) this.render();
  }

  /** Judge: pick the table style a Deal rolls on. */
  static async #onDealStyle(_event, target) {
    await setDealOption(this.document, "style", target.dataset.style);
  }

  /** Judge: set or clear the special treasure choice. */
  static async #onDealSpecial(_event, target) {
    await setDealOption(this.document, "special", target.getAttribute("aria-pressed") !== "true");
  }

  /** Judge: set or clear "Met in their lair". Any warning shown is dropped, since the answer to it changed. */
  static async #onDealLair(_event, target) {
    this.#warned = false;
    await setDealMetInLair(this.document, target.getAttribute("aria-pressed") !== "true");
    this.render();
  }

  /** Judge: Deal. While the lair warning stands it is shown instead of dealing. */
  static #onDealRun() {
    return this.#deal({ confirmed: false });
  }

  /** Judge: Deal anyway, from the lair warning. */
  static #onDealConfirm() {
    return this.#deal({ confirmed: true });
  }

  /** Judge: Cancel, from the lair warning. Nothing is dealt and nothing is said. */
  static #onDealCancel() {
    this.#warned = false;
    this.render();
  }

  /**
   * Deal the ticked rows' letters and the by-hand letter into this pot. Unless
   * confirmed, a standing lair warning is raised in the rail and nothing is dealt;
   * confirmed, the deal runs without asking. What the Judge is told comes from
   * `dealMessages`, one notification each. A second press while a deal runs does
   * nothing.
   */
  async #deal({ confirmed }) {
    if (this.#dealing) return;
    this.#dealing = true;
    try {
      // The by-hand letter is stored when its field changes, and that write may not have landed when this press arrives, so the field is read as it stands.
      const typed = this.element?.querySelector("[data-deal-letter]")?.value.trim();
      if (typed !== undefined && typed !== (potOf(this.document).deal.letter ?? "")) await setDealOption(this.document, "letter", typed);
      const { deal } = potOf(this.document);
      const letters = dealLines(deal).map((line) => line.letter);
      if (!confirmed && lairWarning({ letters, metInLair: deal.metInLair })) {
        this.#warned = true;
        this.#focusWarning = true;
        return;
      }
      this.#warned = false;
      const outcome = await dealLettersIntoPot(this.document, { letters, style: deal.style, special: deal.special, confirmLair: confirmed ? () => true : undefined });
      for (const m of dealMessages(outcome)) ui.notifications?.[m.level](loc(m.key, m.args));
    } catch (err) {
      console.error(`${MODULE_ID} | treasure deal failed`, err);
      ui.notifications?.error(loc("deal.refuse.failed"));
    } finally {
      this.#dealing = false;
      this.render();
    }
  }

  /** Judge: open the staged pot to the table. */
  static async #onOpen() {
    const result = await openPot(this.document);
    if (!result.ok) ui.notifications?.warn(loc(`refuse.${result.reason}`));
  }

  /** Judge: take a card out of the staged pot. */
  static async #onRemove(_event, target) {
    await removeStaged(this.document, target.dataset.cardId);
  }

  /** Judge: a value card by hand, a gem or a piece of jewelry or a special treasure worth some gp. */
  static async #onAddValue() {
    const esc = foundry.utils.escapeHTML;
    const pools = [POOL.gems, POOL.jewelry, POOL.special].map((p) => `<option value="${p}">${esc(loc(`pool.${p}`))}</option>`).join("");
    const got = await DialogV2.prompt({
      classes: DIALOG_CLASSES,
      window: { title: loc("value.title"), icon: "fa-solid fa-gem" },
      content: `<label>${esc(loc("value.pool"))} <select name="pool">${pools}</select></label>
        <label>${esc(loc("value.label"))} <input type="text" name="label"></label>
        <label>${esc(loc("value.gp"))} <input type="number" name="gp" min="0" step="any" value="0"></label>`,
      ok: {
        label: loc("value.add"),
        callback: (_event, button) => {
          const f = button.form.elements;
          return { pool: f.pool.value, label: f.label.value.trim(), gp: Number(f.gp.value) };
        },
      },
      rejectClose: false,
    });
    if (!got || !got.label || !(got.gp >= 0)) return;
    await addTruths(this.document, [normalizeTruth({ pool: got.pool, label: got.label, valueGp: got.gp })]);
  }

  /** Judge: close the pot, filing what is left at a place when one is chosen. */
  static async #onClose() {
    const esc = foundry.utils.escapeHTML;
    const places = providers().map((p) => `<option value="${esc(p.uuid)}">${esc(p.name)}</option>`).join("");
    const got = await DialogV2.prompt({
      classes: DIALOG_CLASSES,
      window: { title: loc("close.title"), icon: "fa-solid fa-box-archive" },
      content: `<p>${esc(loc("close.body"))}</p>
        <label>${esc(loc("close.place"))} <select name="place"><option value="">${esc(loc("close.noPlace"))}</option>${places}</select></label>`,
      ok: { label: loc("close.confirm"), callback: (_event, button) => ({ place: button.form.elements.place.value }) },
      rejectClose: false,
    });
    if (!got) return;
    const result = await closePot(this.document, { placeUuid: got.place || null });
    if (!result.ok) ui.notifications?.warn(loc(`refuse.${result.reason}`));
  }
}
