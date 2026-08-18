/* global game, ui, document */
/**
 * The magic-item panel the equipment item sheet mounts on its Construction
 * tab (the goods-schema precedent: equipment owns the sheet and one mount
 * line; markets owns this panel and the flag it edits).
 *
 * GM: declare the item magic and set its market identity — kind, rarity,
 * apparent value, base cost, maker's provenance, identification state.
 * Owners: attempt identification through the JJ method ladder with any
 * qualified character or henchman.
 */
import { MODULE_ID, LANG, ITEM_FLAG } from "../constants.mjs";
import { RARITIES, MAGIC_KINDS, ID_STATES } from "../config.mjs";
import { availableMethods, identifyAttempt, candidateIdentifiers } from "../engine/identify.mjs";
import { makeLoc } from "../../lib/util.mjs";

const loc = makeLoc(LANG);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function labeled(labelKey, input) {
  const row = el("div", "form-group");
  row.appendChild(el("label", null, loc(labelKey)));
  row.appendChild(input);
  return row;
}

function select(options, value, onChange) {
  const node = document.createElement("select");
  for (const { v, label } of options) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = label;
    if (String(v) === String(value)) opt.selected = true;
    node.appendChild(opt);
  }
  node.addEventListener("change", () => onChange(node.value));
  return node;
}

function numberInput(value, onChange) {
  const node = document.createElement("input");
  node.type = "number";
  node.min = "0";
  node.step = "1";
  node.value = value ?? 0;
  node.addEventListener("change", () => onChange(Number(node.value) || 0));
  return node;
}

/** @returns {HTMLElement} the panel root */
export function buildMagicPanel(item) {
  const root = el("section", "acks-extras-markets-magic");
  const flag = () => item.getFlag(MODULE_ID, ITEM_FLAG) ?? {};
  const setFlag = (patch) => item.setFlag(MODULE_ID, ITEM_FLAG, { ...flag(), ...patch });
  const f = flag();

  root.appendChild(el("h3", null, loc("magic.header")));

  if (game.user.isGM) {
    const magicToggle = document.createElement("input");
    magicToggle.type = "checkbox";
    magicToggle.checked = !!f.magic;
    magicToggle.addEventListener("change", () => setFlag({ magic: magicToggle.checked }));
    root.appendChild(labeled("magic.isMagic", magicToggle));
  }

  if (!f.magic) {
    if (!game.user.isGM) root.remove();
    return root;
  }

  if (game.user.isGM) {
    root.appendChild(
      labeled("magic.kind", select(MAGIC_KINDS.map((v) => ({ v, label: loc(`magic.kinds.${v}`) })), f.kind ?? "misc", (v) => setFlag({ kind: v })))
    );
    root.appendChild(
      labeled("magic.rarity", select(RARITIES.map((v) => ({ v, label: loc(`magic.rarities.${v}`) })), f.rarity ?? "common", (v) => setFlag({ rarity: v })))
    );
    root.appendChild(labeled("magic.apparentValue", numberInput(f.apparentValueGp ?? 0, (v) => setFlag({ apparentValueGp: v }))));
    root.appendChild(labeled("magic.baseCost", numberInput(f.baseCostGp ?? Number(item.system?.cost ?? 0), (v) => setFlag({ baseCostGp: v }))));
    const selfMade = document.createElement("input");
    selfMade.type = "checkbox";
    selfMade.checked = !!f.selfMade;
    selfMade.addEventListener("change", () => setFlag({ selfMade: selfMade.checked }));
    root.appendChild(labeled("magic.selfMade", selfMade));
    root.appendChild(
      labeled("magic.identified", select(ID_STATES.map((v) => ({ v, label: loc(`magic.states.${v}`) })), f.identified ?? "none", (v) => setFlag({ identified: v })))
    );
  } else {
    const state = f.identified ?? "none";
    root.appendChild(el("p", "hint", game.i18n.format(`${LANG}.magic.stateLine`, { state: loc(`magic.states.${state}`) })));
  }

  // Identification attempts: any qualified character or henchman the user
  // may act through.
  if ((f.identified ?? "none") !== "full") {
    const identifiers = candidateIdentifiers();
    if (identifiers.length) {
      const box = el("div", "acks-extras-markets-identify");
      box.appendChild(el("h4", null, loc("identify.header")));
      let chosen = identifiers[0];
      const methodSelect = document.createElement("select");
      const refreshMethods = () => {
        methodSelect.innerHTML = "";
        for (const key of availableMethods(item, chosen)) {
          const opt = document.createElement("option");
          opt.value = key;
          opt.textContent = loc(`identify.method.${key}`);
          methodSelect.appendChild(opt);
        }
        if (!methodSelect.options.length) {
          const opt = document.createElement("option");
          opt.value = "";
          opt.textContent = loc("identify.noneAvailable");
          methodSelect.appendChild(opt);
        }
      };
      const who = select(identifiers.map((a) => ({ v: a.id, label: a.name })), chosen.id, (v) => {
        chosen = game.actors.get(v) ?? chosen;
        refreshMethods();
      });
      refreshMethods();
      box.appendChild(labeled("identify.who", who));
      box.appendChild(labeled("identify.methodLabel", methodSelect));
      const btn = el("button", "acks-location-btn", loc("identify.attempt"));
      btn.type = "button";
      btn.addEventListener("click", async () => {
        if (!methodSelect.value) return;
        const result = await identifyAttempt(item, { identifier: chosen, method: methodSelect.value });
        if (result?.error) ui.notifications.warn(loc(`identify.error.${result.error}`));
      });
      box.appendChild(btn);
      root.appendChild(box);
    }
  }

  return root;
}
