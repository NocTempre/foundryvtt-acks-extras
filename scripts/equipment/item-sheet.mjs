/* global game, foundry, CONFIG, document, Item, ui */
/**
 * The ACKS Equipment item sheet — a SUBCLASS of the system's own item sheet
 * (the acks-abilities precedent: inherit the header, description, effects and
 * contents parts verbatim; core stays untouched) registered as the default for
 * weapon / armor / item documents. It restructures the sheet:
 *
 *   description   prose, plus core's own stats side-column for everything that
 *                 does not throw dice
 *   rolls         WEAPONS ONLY: core's details field-set (damage, bonus,
 *                 melee/missile, range, save), MOVED here as core's own nodes
 *                 so every core binding and data-action keeps working
 *   construction  what the item IS — masterwork, condition, material, shield
 *                 variant, helmet — the module's property layers
 *   spells        ONLY on a recognised Spell Book (a specific item class, never
 *                 a property of ordinary gear): the recorded formulae
 *   effects       core's Active Effects tab, untouched
 *
 * The two identity overlays ride the HEADER, not a tab: the JJ named-item state
 * and the GM's apparent-identity mask are badges beside the name that unfold an
 * overlay strip. An identity is something the item wears everywhere — pinning it
 * to a tab buried it.
 */
import { MODULE_ID, ITEM_FLAGS } from "./constants.mjs";
import { buildConstructionPanel } from "./sheet.mjs";
import { disguiseItem, revealItem } from "./actions.mjs";
import { isDisguised } from "./actions.mjs";
import {
  isSpellbook, spellbookSpells, setSpellbookSpells, parseSpellList, formatSpellList,
  pagesUsed, pagesCapacity, spellbookValue,
} from "./spellbook.mjs";
import * as named from "./overlays/named.mjs";
import { buildMagicPanel } from "../markets/apps/magic-panel.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";

const T = `modules/${MODULE_ID}/templates/equipment`;
export const EQUIPMENT_SHEET_TYPES = [ITEM_TYPE.weapon, ITEM_TYPE.armor, ITEM_TYPE.item];

/** The system's registered (default) item sheet class — our base. */
export function resolveItemSheetBase() {
  const registered = CONFIG.Item?.sheetClasses?.weapon ?? {};
  const entries = Object.values(registered);
  const defaulted = entries.find((e) => e.default) ?? null;
  const chosen = defaulted ?? entries[0] ?? null;
  // Registry order is not a choice: when several entries compete and none is
  // flagged default, name the class adopted so a wrong base is diagnosable
  // from the console. A lone entry is unambiguous and stays quiet.
  if (!defaulted && entries.length > 1) {
    console.warn(`${MODULE_ID} | no weapon sheet is flagged default; extending ${chosen.cls?.name} by registry order.`);
  }
  return chosen?.cls ?? null;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @param {typeof foundry.applications.api.ApplicationV2} Base the system's item sheet class
 */
export function createEquipmentItemSheet(Base) {
  const P = Base.PARTS ?? {};
  const baseTabs = Base.TABS?.primary?.tabs ?? [];
  const tabById = Object.fromEntries(baseTabs.map((t) => [t.id, t]));

  return class AcksEquipmentItemSheet extends Base {
    static DEFAULT_OPTIONS = {
      classes: ["acks-ui", "acks", "acks2", "item-v2", "acks-equipment-item", "acks-extras-scroll"],
    };

    static PARTS = {
      header: P.header,
      tabs: P.tabs,
      description: P.description,
      rolls: { template: `${T}/item-rolls.hbs`, scrollable: [""] },
      construction: { template: `${T}/item-construction.hbs`, scrollable: [""] },
      spells: { template: `${T}/item-spells.hbs`, scrollable: [""] },
      // A base part the system does not define must not reach the framework as
      // an `undefined` config.
      ...(P.effects ? { effects: P.effects } : {}),
      ...(P.contents ? { contents: P.contents } : {}),
    };

    static TABS = {
      primary: {
        tabs: [
          tabById.description ?? { id: "description", label: "ACKS.category.description" },
          { id: "rolls", label: "ACKS-EQUIPMENT.tab.rolls" },
          { id: "construction", label: "ACKS-EQUIPMENT.tab.construction" },
          { id: "spells", label: "ACKS-EQUIPMENT.tab.spells" },
          tabById.effects ?? { id: "effects", label: "ACKS.category.effects" },
          tabById.contents ?? { id: "contents", label: "ACKS.category.contents" },
        ],
        initial: "description",
      },
    };

    tabGroups = { primary: "description" };

    /**
     * A Rolls tab exists only where core's details field-set is ROLLS.
     *
     * It is one field-set per item type and only the weapon's holds throws —
     * damage, attack bonus, melee/missile, range, save. An armour's is its AC
     * and armour type and an item's is its subtype and quantity: facts about
     * what the thing IS, which belong beside the prose that describes it. Sent
     * to a tab labelled Rolls they read as dice nobody can find, and leave the
     * description with an empty column beside it.
     */
    get #hasRolls() {
      return this.item.type === ITEM_TYPE.weapon;
    }

    /** The Spells tab exists ONLY on a recognised Spell Book. */
    _configureRenderParts(options) {
      const parts = super._configureRenderParts(options);
      if (!isSpellbook(this.item)) delete parts.spells;
      if (!this.#hasRolls) delete parts.rolls;
      return parts;
    }

    _prepareTabs(group) {
      const tabs = super._prepareTabs(group);
      if (group !== "primary") return tabs;
      if (!isSpellbook(this.item)) delete tabs.spells;
      if (!this.#hasRolls) delete tabs.rolls;
      return tabs;
    }

    /** Which overlay strip is open, surviving the re-render every form change causes. */
    #openStrip = null;

    async _onRender(context, options) {
      await super._onRender(context, options);
      // Each decoration guards itself: one failing must not take the others —
      // or worse, the whole sheet — with it.
      const steps = [
        ["rolls", () => this.#moveDetailsIntoRolls()],
        ["construction", () => this.#fillConstruction()],
        ["spells", () => this.#fillSpells()],
        ["header overlays", () => this.#injectHeaderOverlays()],
      ];
      for (const [what, step] of steps) {
        try {
          step();
        } catch (err) {
          console.error(`${MODULE_ID} | equipment item sheet: ${what} decoration failed`, err);
        }
      }
    }

    /**
     * Core's details field-set renders inside the description part (its left
     * side-column). For a WEAPON, MOVE the node — core's own markup, inputs and
     * data-actions — into the Rolls pane, so nothing is re-templated and
     * everything keeps submitting through the same form.
     *
     * Everything else is left exactly where core put it, which is the sidebar
     * beside the description. Leaving it is not the same as putting it back: the
     * node is never detached, so no core binding is even briefly orphaned.
     */
    #moveDetailsIntoRolls() {
      if (!this.#hasRolls) return;
      const rollsPane = this.element.querySelector(".acks-equipment-tab-rolls");
      const details = this.element.querySelector('[data-tab="description"] .field-set--narrow');
      if (!rollsPane || !details) return;
      rollsPane.appendChild(details);
    }

    #fillConstruction() {
      const pane = this.element.querySelector(".acks-equipment-tab-construction");
      if (!pane || pane.querySelector(".acks-equipment-props")) return;
      pane.appendChild(buildConstructionPanel(this.item));
      // The markets feature's magic-item panel (flags it owns; one mount
      // line here — the goods-schema precedent).
      pane.appendChild(buildMagicPanel(this.item));
    }

    /** The Spells tab: the book's recorded formulae, edited in place. */
    #fillSpells() {
      const pane = this.element.querySelector(".acks-equipment-tab-spells");
      if (!pane || pane.querySelector(".acks-equipment-props__spells")) return;
      const item = this.item;
      const ta = el("textarea", "acks-equipment-props__spells");
      ta.rows = 14;
      ta.value = formatSpellList(spellbookSpells(item));
      ta.placeholder = game.i18n.localize("ACKS-EQUIPMENT.spellbook.prompt");
      ta.addEventListener("change", (ev) => {
        ev.stopPropagation(); // the sheet submits on change; this is a flag write
        setSpellbookSpells(item, parseSpellList(ta.value)).catch((e) => console.error(`${MODULE_ID} | spellbook`, e));
      });
      const note = el("p", "acks-equipment-props__note",
        `${pagesUsed(item)}/${pagesCapacity(item)} ${game.i18n.localize("ACKS-EQUIPMENT.spellbook.pages")} · ${spellbookValue(item)}gp`);
      const hint = el("p", "acks-equipment-props__note", game.i18n.localize("ACKS-EQUIPMENT.spellbook.prompt"));
      pane.append(hint, ta, note);
    }

    /* ---------------------------------------------------------------- */
    /*  Header overlays: named item + apparent identity                  */
    /* ---------------------------------------------------------------- */

    #injectHeaderOverlays() {
      const header = this.element.querySelector(".sheet-header");
      if (!header) return;
      // IDEMPOTENT REBUILD. The badges die with the header when its part
      // re-renders, but the STRIPS container sits between parts and used to
      // survive — every form change (the sheet submits on change) re-rendered
      // and injected a fresh copy beside the orphan, so strips accumulated and
      // a stale one could sit permanently open. Remove every prior copy, then
      // rebuild, restoring which strip the user had open.
      for (const stale of this.element.querySelectorAll(".acks-equipment-idbar, .acks-equipment-idbar__strips")) stale.remove();
      const item = this.item;
      const bar = el("div", "acks-equipment-idbar");
      const strips = el("div", "acks-equipment-idbar__strips");

      const badge = (icon, tooltip, active, onToggle) => {
        const a = el("a", `acks-equipment-idbar__badge${active ? " active" : ""}`);
        a.innerHTML = `<i class="fas ${icon}"></i>`;
        a.dataset.tooltip = tooltip;
        a.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          onToggle();
        });
        return a;
      };
      const setOpen = (key) => {
        this.#openStrip = key;
        for (const s of strips.children) s.classList.toggle("open", s.dataset.strip === key);
      };
      const toggleStrip = (key) => setOpen(this.#openStrip === key ? null : key);

      // NAMED (JJ p399). A NAMED item shows its tracker — the record is on the
      // item, and hiding it is how "where's the named item tracker?" happens.
      // The overlay setting gates the AUTOMATION (level-up advancement) and
      // whether a GM is offered the badge on ordinary, unnamed gear. A DISGUISE
      // outranks all of it for players: an apparent identity must not wear a
      // "named item" badge (named.trackerVisible owns the rule).
      if (named.trackerVisible({ isNamed: named.isNamed(item), disguised: isDisguised(item), isGM: game.user.isGM, overlayOn: named.overlayEnabled() })) {
        const strip = this.#buildNamedStrip(item);
        strip.dataset.strip = "named";
        strips.append(strip);
        const rec = named.namedOf(item);
        const state = rec
          ? game.i18n.format("ACKS-EQUIPMENT.named.badge", { n: named.unlockedDisplay(item), max: named.maxOf(item) || "?" })
          : game.i18n.localize("ACKS-EQUIPMENT.named.badgeNone");
        bar.append(badge("fa-signature", state, !!rec, () => toggleStrip("named")));
      }

      // APPARENT IDENTITY — GM only; players must see nothing.
      if (game.user.isGM) {
        const strip = this.#buildDisguiseStrip(item);
        strip.dataset.strip = "disguise";
        strips.append(strip);
        const on = isDisguised(item);
        const tip = on
          ? game.i18n.format("ACKS-EQUIPMENT.disguise.shown", { name: item.getFlag(MODULE_ID, ITEM_FLAGS.DISGUISE)?.true?.name ?? "?" })
          : game.i18n.localize("ACKS-EQUIPMENT.disguise.off");
        bar.append(badge("fa-mask", tip, on, () => toggleStrip("disguise")));
      }

      if (!bar.children.length) return;
      header.appendChild(bar);
      header.after(strips);
      // A strip the user had open stays open across the re-render every field
      // edit triggers (applying a disguise no longer snaps the strip shut —
      // or, before the orphan fix, left a DEAD copy of it open).
      if (this.#openStrip) setOpen(this.#openStrip);
    }

    /** Small helpers for overlay strips. */
    #stripField(value, placeholderKey, type = "text") {
      const i = el("input", "acks-equipment-props__input");
      i.type = type;
      i.value = value ?? "";
      i.placeholder = game.i18n.localize(placeholderKey);
      i.addEventListener("change", (ev) => ev.stopPropagation());
      return i;
    }

    #stripButton(labelKey, onClick, extra = "") {
      const b = el("button", `acks-equipment-props__btn narrow ${extra}`.trim(), game.i18n.localize(labelKey));
      b.type = "button";
      b.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        Promise.resolve(onClick()).catch((e) => console.error(`${MODULE_ID} | header overlay`, e));
      });
      return b;
    }

    #buildDisguiseStrip(item) {
      const strip = el("div", "acks-equipment-idbar__strip acks-equipment-idbar__strip--disguise");
      const d = item.getFlag(MODULE_ID, ITEM_FLAGS.DISGUISE);
      const ap = d?.apparent ?? {};
      const nameF = this.#stripField(ap.name ?? item.name, "ACKS-EQUIPMENT.disguise.nameHint");
      const costF = this.#stripField(ap.cost ?? item.system?.cost ?? 0, "ACKS-EQUIPMENT.disguise.cost", "number");
      const statF = item.type === ITEM_TYPE.weapon
        ? this.#stripField(ap.damage ?? item.system?.damage ?? "", "ACKS-EQUIPMENT.disguise.damage")
        : item.type === ITEM_TYPE.armor
          ? this.#stripField(ap.ac ?? item.system?.aac?.value ?? 0, "ACKS-EQUIPMENT.disguise.ac", "number")
          : null;
      strip.append(
        el("span", "acks-equipment-idbar__label", game.i18n.localize("ACKS-EQUIPMENT.props.disguise")),
        nameF, costF, ...(statF ? [statF] : []),
        this.#stripButton(d ? "ACKS-EQUIPMENT.disguise.update" : "ACKS-EQUIPMENT.disguise.apply", () =>
          disguiseItem(item, {
            name: nameF.value, cost: costF.value,
            ...(item.type === ITEM_TYPE.weapon ? { damage: statF.value } : {}),
            ...(item.type === ITEM_TYPE.armor ? { ac: statF.value } : {}),
          })),
        ...(d ? [this.#stripButton("ACKS-EQUIPMENT.disguise.reveal", () => revealItem(item))] : []),
        el("span", `acks-equipment-props__note${d ? " acks-equipment-props__note--warn" : ""}`,
          d ? game.i18n.format("ACKS-EQUIPMENT.disguise.shown", { name: d.true?.name ?? "?" })
            : game.i18n.localize("ACKS-EQUIPMENT.disguise.off")),
      );
      return strip;
    }

    #buildNamedStrip(item) {
      const strip = el("div", "acks-equipment-idbar__strip acks-equipment-idbar__strip--named");
      const rec = named.namedOf(item);

      if (rec) {
        // THE TRACKER: one rung per point of the item's power, in the Judge's
        // unlock order — lit when unlocked, dimmed when still sealed. A legacy
        // record (unlocked/max with no ladder yet) shows unlabelled rungs so the
        // progress is still visible before the Judge sets the order.
        const ladder = named.ladderOf(item);
        const max = named.maxOf(item);
        const litCount = named.unlockedDisplay(item);
        const track = el("div", "acks-equipment-named-track");
        for (let i = 0; i < max; i++) {
          const cat = named.NAMED_CATEGORIES[ladder[i]]?.label ?? game.i18n.localize("ACKS-EQUIPMENT.named.rungUnset");
          const rung = el("span", `acks-equipment-named-track__rung${i < litCount ? " lit" : ""}`);
          rung.innerHTML = `<i class="fas ${i < litCount ? "fa-circle" : "fa-circle-dot"}"></i>`;
          rung.dataset.tooltip = `${i + 1}. ${cat}${i < litCount ? "" : ` — ${game.i18n.localize("ACKS-EQUIPMENT.named.sealed")}`}`;
          track.append(rung);
        }
        const b = named.unlockedBonuses(item);
        const bits = [];
        if (b.hit) bits.push(`+${b.hit} hit`);
        if (b.damage) bits.push(`+${b.damage} dmg`);
        if (b.ac) bits.push(`+${b.ac} AC`);
        if (b.encumbrance) bits.push(`−${b.encumbrance} st`);
        if (b.power) bits.push(`${b.power} power(s)`);
        strip.append(
          el("span", "acks-equipment-idbar__label",
            game.i18n.format("ACKS-EQUIPMENT.named.trackLabel", { given: rec.givenName ?? item.name, n: litCount, max })),
          track,
          el("span", "acks-equipment-props__note",
            (bits.length ? game.i18n.format("ACKS-EQUIPMENT.named.bonusLine", { bonuses: bits.join(", ") }) : game.i18n.localize("ACKS-EQUIPMENT.named.noBonuses")) +
            (rec.revealed ? ` — ${game.i18n.localize("ACKS-EQUIPMENT.named.revealed")}` : "")),
        );
        // A record with no ladder cannot APPLY anything — the Judge sets the
        // unlock order (JJ p399); say so instead of silently granting nothing.
        if (!ladder.length && game.user.isGM) {
          strip.append(el("span", "acks-equipment-props__note acks-equipment-props__note--warn",
            game.i18n.localize("ACKS-EQUIPMENT.named.noLadder")));
        }
        // The automation (advance on level-up) rides the overlay setting.
        if (!named.overlayEnabled() && game.user.isGM) {
          strip.append(el("span", "acks-equipment-props__note acks-equipment-props__note--warn",
            game.i18n.localize("ACKS-EQUIPMENT.named.overlayOff")));
        }

        // Speak a name — the wielder's once-per-level guess (JJ p399).
        const speaker = item.parent ?? game.user.character ?? null;
        const guessF = this.#stripField("", "ACKS-EQUIPMENT.named.guessHint");
        strip.append(guessF, this.#stripButton("ACKS-EQUIPMENT.named.guess", async () => {
          if (!speaker) return ui.notifications.warn(game.i18n.localize("ACKS-EQUIPMENT.named.noSpeaker"));
          const res = named.resolveGuess(item, speaker, guessF.value);
          if (!res.allowed) return ui.notifications.warn(game.i18n.format("ACKS-EQUIPMENT.named.noGuess", { name: speaker.name }));
          await item.update(res.updates);
          if (res.correct) {
            await item.update(named.applyUpdates(item));
            ui.notifications.info(game.i18n.format("ACKS-EQUIPMENT.named.correct", { item: item.name }));
          } else {
            ui.notifications.info(game.i18n.format("ACKS-EQUIPMENT.named.wrong", { name: speaker.name }));
          }
        }));

        // RE-NAME — the other JJ p399 path: a finder gives the item a NEW name,
        // unlocking a first point immediately; the item is thereafter called by
        // that name. A state edit, not automation, so it is NEVER gated on the
        // overlay setting (which used to make renaming impossible when off).
        if (game.user.isGM || item.isOwner) {
          const renameF = this.#stripField(rec.givenName ?? item.name, "ACKS-EQUIPMENT.named.renameHint");
          strip.append(renameF, this.#stripButton("ACKS-EQUIPMENT.named.rename", async () => {
            const given = renameF.value.trim();
            if (!given) return;
            const wielderLevel = Number((item.parent ?? game.user.character)?.system?.details?.level ?? 1);
            await item.update(named.renameUpdates(item, given, wielderLevel));
            await item.update(named.applyUpdates(item));
            ui.notifications.info(game.i18n.format("ACKS-EQUIPMENT.named.renamed", { item: given }));
          }));
        }
      }

      // GM: set or edit the record — true name, the Judge's unlock ladder, and
      // how many rungs are currently unlocked.
      if (game.user.isGM) {
        const trueF = this.#stripField(rec?.trueName ?? "", "ACKS-EQUIPMENT.named.trueHint");
        const ladderF = this.#stripField((named.ladderOf(item) ?? []).join(","), "ACKS-EQUIPMENT.named.ladderHint");
        const unlockedF = this.#stripField(rec?.unlocked ?? 0, "ACKS-EQUIPMENT.named.unlockedHint", "number");
        strip.append(
          trueF, ladderF, unlockedF,
          this.#stripButton(rec ? "ACKS-EQUIPMENT.named.save" : "ACKS-EQUIPMENT.named.make", async () => {
            const keys = Object.keys(named.NAMED_CATEGORIES);
            const ladder = ladderF.value.split(",").map((s) => s.trim().toLowerCase()).filter((s) => keys.includes(s));
            const record = {
              ...(rec ?? {}),
              trueName: trueF.value.trim(),
              givenName: rec?.givenName ?? item.name,
              ladder,
              unlocked: Math.max(0, parseInt(unlockedF.value, 10) || 0),
              revealed: rec?.revealed ?? false,
              base: rec?.base ?? named.captureBase(item),
            };
            await item.setFlag(MODULE_ID, ITEM_FLAGS.NAMED, record);
            await item.update(named.applyUpdates(item));
          }),
          ...(rec ? [this.#stripButton("ACKS-EQUIPMENT.named.unmake", async () => {
            const base = named.baseOf(item);
            await item.update({
              "system.bonus": base.bonus,
              ...(item.type === ITEM_TYPE.weapon ? { "system.damage": base.damage } : {}),
              ...(item.type === ITEM_TYPE.armor ? { "system.aac.value": base.aac } : {}),
              "system.weight6": base.weight6,
            });
            await item.unsetFlag(MODULE_ID, ITEM_FLAGS.NAMED);
          })] : []),
        );
        strip.append(el("span", "acks-equipment-props__note", game.i18n.localize("ACKS-EQUIPMENT.named.gmHint")));
      }
      return strip;
    }
  };
}

/** Register the sheet as the default for equipment item types. Call at ready. */
export function registerEquipmentItemSheet() {
  const Base = resolveItemSheetBase();
  if (!Base) {
    console.error(`${MODULE_ID} | could not resolve the system item sheet; equipment item sheet NOT registered.`);
    return;
  }
  // The subclass leans on the shape of the system's sheet (its header/tabs/
  // description parts and the details field-set the Rolls tab adopts). A system
  // build without that shape gets CORE'S sheet, not a broken one of ours.
  const P = Base.PARTS ?? {};
  if (!P.header || !P.tabs || !P.description) {
    console.warn(`${MODULE_ID} | the system item sheet does not have the expected parts (header/tabs/description); keeping the system sheet.`);
    return;
  }
  const Cls = createEquipmentItemSheet(Base);
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Item, MODULE_ID, Cls, {
    types: EQUIPMENT_SHEET_TYPES,
    makeDefault: true,
    label: game.i18n.localize("ACKS-EQUIPMENT.sheet.label"),
  });
  console.debug(`${MODULE_ID} | equipment item sheet registered (default for ${EQUIPMENT_SHEET_TYPES.join("/")}).`);
}
