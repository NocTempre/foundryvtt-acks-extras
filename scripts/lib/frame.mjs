/* global foundry, game */
/**
 * The sheet frame: the one vocabulary every actor sheet of this module draws
 * with — a title band in the window header, an art row of rail cells around
 * the portrait, a tab strip with a fold, and a folded card of pins — stated
 * once here and in `styles/lib-frame.css`, `templates/lib/frame/` and
 * `frame-model.mjs`. The character sheet is its first consumer; the Full
 * Monster sheet, the Follower Card and the roster draw with the same classes.
 *
 * `FrameMixin` is the Foundry half: the fold (a user flag, the window resized
 * to the card), the band moved into the header, the view-only actions kept
 * live on a read-only seat, the menu under a rail cell, and the pins on the
 * document's sheet flag. A consumer sets `classes`, `position` and
 * `window.contentClasses` whole, lists its own view-only actions in a static
 * `VIEW_ACTIONS`, its two canvas widths in `FRAME_WIDTHS`, and runs its own
 * render steps after `super._onRender`. The decisions on plain data are
 * `frame-model.mjs`; the mechanics are docs/lib/MODEL.md, "The sheet frame".
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { atTypeScale } from "./util.mjs";
import { moveBandIntoHeader } from "./header-band.mjs";
import { FOLD_FLAG, SHEET_FLAG, sheetFlag, togglePin } from "./frame-model.mjs";

export { FOLD_FLAG, SHEET_FLAG, sheetFlag };

/** The frame's root class: the stylesheet's every selector hangs off it or its `__` members. */
export const FRAME_CLASS = "acks-extras-frame";

/** The lang root of the frame's own strings (fold, pin, roll, post); a sheet binds `makeLoc` to it beside its own root. */
export const FRAME_LANG_PREFIX = `${LANG_PREFIX}.frame`;

/** The frame's partials, preloaded by the lib at init; `rails.hbs` includes `cell.hbs` by path. */
export const FRAME_TEMPLATES = Object.freeze(
  ["band", "cell", "rails", "folded", "tabs"].map((n) => `modules/${MODULE_ID}/templates/lib/frame/${n}.hbs`),
);

/**
 * Actions that only LOOK — the fold and a tab change — and so stay live on a
 * sheet the viewer cannot edit. A consumer's `VIEW_ACTIONS` adds its own.
 */
export const FRAME_VIEW_ACTIONS = Object.freeze(["fold", "goTab", "tab"]);

/** The canvas widths a frame opens at and folds to, before the type-size ratio. */
export const FRAME_WIDTHS = Object.freeze({ open: 900, folded: 400 });

/**
 * The frame's own actions, bound with `this` as the sheet; the mixin's
 * DEFAULT_OPTIONS merges them into a consumer's `actions`.
 */
export const FRAME_ACTIONS = Object.freeze({
  /** Fold or unfold, for the viewing user. */
  async fold() {
    await this.setFold(!this.folded);
  },
  /** Go to the tab the control names, on an open sheet that has it. */
  goTab(event, target) {
    const { tab, group = "primary" } = target.dataset;
    if (this.folded || !tab) return;
    if (this.element.querySelector(`.tabs [data-group="${group}"][data-tab="${tab}"]`)) this.changeTab(tab, group);
  },
});

/**
 * The frame over a document sheet. `Base` is a HandlebarsApplicationMixin
 * over a DocumentSheetV2; the frame reads `this.document` and nothing of the
 * document's type.
 */
export function FrameMixin(Base) {
  return class FrameSheet extends Base {
    static DEFAULT_OPTIONS = { actions: { ...FRAME_ACTIONS } };

    /** The actions a read-only seat keeps; a consumer lists its own beside the frame's. */
    static VIEW_ACTIONS = new Set(FRAME_VIEW_ACTIONS);

    /** The widths this sheet opens at and folds to; a consumer states its own canvas figures. */
    static FRAME_WIDTHS = FRAME_WIDTHS;

    /**
     * Open at the canvas width for the seat's type size. `DEFAULT_OPTIONS` is
     * evaluated before settings exist, so the scale is applied here at
     * construction instead; core clamps the result to the viewport.
     */
    _initializeApplicationOptions(options) {
      const opts = super._initializeApplicationOptions(options);
      if (opts.position?.width) opts.position.width = atTypeScale(opts.position.width);
      return opts;
    }

    /** Is this sheet folded for the viewing user? */
    get folded() {
      return !!game.user.getFlag(MODULE_ID, FOLD_FLAG)?.[this.document.id];
    }

    /**
     * Fold or unfold and re-render. The flag is written as an explicit true
     * or false per document: `setFlag` MERGES an object, so a key deleted
     * from a copy would survive the write.
     */
    async setFold(next) {
      await game.user.setFlag(MODULE_ID, FOLD_FLAG, { [this.document.id]: !!next });
      this.render();
    }

    /** The fold state the window was last sized for. */
    #foldedWas = null;

    /**
     * Size the window to its state: the card narrows, the open sheet widens
     * back. Done after render, once the root carries `is-folded`, because the
     * open sheet's minimum width would otherwise clamp the card's.
     */
    _sizeForFold(folded) {
      if (this.#foldedWas === folded) return;
      this.#foldedWas = folded;
      const widths = this.constructor.FRAME_WIDTHS;
      this.setPosition({ width: atTypeScale(folded ? widths.folded : widths.open), height: "auto" });
    }

    /**
     * The frame's render pass: the fold on the root and the window's size,
     * the view-only actions re-enabled where DocumentSheetV2 disabled every
     * control, then the band into the header. A consumer's own steps follow
     * its `super._onRender`, through `_renderSteps`.
     */
    async _onRender(context, options) {
      await super._onRender(context, options);
      const folded = !!(context?.folded ?? this.folded);
      this.element.classList.toggle("is-folded", folded);
      this._sizeForFold(folded);
      if (!this.isEditable) {
        const live = this.constructor.VIEW_ACTIONS;
        for (const button of this.element.querySelectorAll("button[data-action]")) {
          if (live.has(button.dataset.action)) button.disabled = false;
        }
      }
      this._renderSteps([["band", () => moveBandIntoHeader(this.element)]]);
    }

    /** Run render steps one by one; a step that throws is logged and the rest still run. */
    _renderSteps(steps) {
      for (const [what, step] of steps) {
        try {
          step();
        } catch (err) {
          console.error(`${MODULE_ID} | ${this.constructor.name}: ${what} failed`, err);
        }
      }
    }

    /**
     * A small menu under a rail cell: one row per option, the current one
     * marked; a click picks, a click anywhere else closes. Built by the
     * anchor's own document, so a sheet in a detached window gets a menu of
     * that window's.
     * @param {HTMLElement} anchor the cell the menu hangs under
     * @param {object[]} items [{label, icon?, img?, value?, on?, disabled?}, …]
     * @param {(item: object) => any} onPick called with the item picked
     */
    _frameMenu(anchor, items, onPick) {
      const doc = anchor.ownerDocument;
      this.element.querySelector(`.${FRAME_CLASS}__menu`)?.remove();
      const menu = doc.createElement("div");
      menu.className = `${FRAME_CLASS}__menu`;
      menu.innerHTML = items
        .map(
          (it, i) =>
            `<button type="button" class="${FRAME_CLASS}__menu-item${it.on ? " is-on" : ""}" data-menu-index="${i}"${it.disabled ? " disabled" : ""}>` +
            `${it.icon ? `<i class="${it.icon}" inert></i>` : it.img ? `<img src="${it.img}" alt="" inert>` : ""}<span>${foundry.utils.escapeHTML(it.label)}</span>` +
            `${it.value != null ? `<b>${foundry.utils.escapeHTML(String(it.value))}</b>` : ""}</button>`,
        )
        .join("");
      const rail = anchor.closest(`.${FRAME_CLASS}__rail`) ?? anchor.parentElement;
      rail.style.position = "relative";
      menu.style.top = `${anchor.offsetTop}px`;
      rail.append(menu);
      const close = () => {
        menu.remove();
        doc.removeEventListener("pointerdown", onOutside, true);
      };
      const onOutside = (ev) => {
        if (!menu.contains(ev.target)) close();
      };
      setTimeout(() => doc.addEventListener("pointerdown", onOutside, true), 0);
      menu.addEventListener("click", (ev) => {
        const btn = ev.target.closest("[data-menu-index]");
        if (!btn) return;
        ev.preventDefault();
        ev.stopPropagation();
        close();
        Promise.resolve(onPick(items[Number(btn.dataset.menuIndex)])).catch((err) => console.error(`${MODULE_ID} | menu pick failed`, err));
      });
    }

    /** Star or unstar one id on the document's sheet flag. */
    async _togglePinId(id) {
      if (!id) return;
      const flag = foundry.utils.deepClone(sheetFlag(this.document));
      flag.pins = togglePin(flag.pins, id);
      await this.document.setFlag(MODULE_ID, SHEET_FLAG, flag);
    }
  };
}
