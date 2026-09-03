/* global game, Hooks, Actor */
/**
 * Category tabs over the character sheet's ability and spell lists.
 *
 * Abilities file into fixed buckets — fighting, thief skills, general
 * proficiencies, class proficiencies, class powers, racial abilities —
 * resolved from what the items already carry:
 * the training flag, the importer's cookbook id, the proficiency type, and
 * the bound class document's award notes (a racial trait is whatever the
 * class awards with a racial-trait note). Spells file by their tradition
 * (`system.class`: Arcane, Divine, and whatever later books add), so an
 * eldritch or ceremonial list grows its tab the day such spells exist.
 *
 * The bar filters rows in place; the active pick survives re-renders on the
 * application instance. Only lists that would actually split get a bar.
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { classForActor } from "./registry.mjs";
import { cookbookId } from "../lib/library.mjs";
import { ITEM_TYPE, ACTOR_TYPE } from "../lib/vocab.mjs";

const ABILITY_ORDER = ["fighting", "thief", "general", "class", "powers", "racial", "language"];

/** The buckets in display order, for a sheet that files abilities itself. */
export const ABILITY_BUCKETS = Object.freeze([...ABILITY_ORDER]);

/**
 * The refs the bound class awards as racial traits — what tells a racial
 * bucket from the powers it is otherwise indistinguishable from.
 * @returns {Set<string>}
 */
export function racialRefsOf(actor) {
  return new Set(
    (classForActor(actor)?.system.awards ?? [])
      .filter((a) => /racial trait/i.test(a.note ?? ""))
      .map((a) => a.ref)
      .filter(Boolean),
  );
}

/** The bucket one ability item belongs to. Racial outranks powers: racial
 *  traits ARE power defs, distinguished only by how the class awards them. */
export function abilityBucket(item, racialRefs) {
  return categorize(item, racialRefs);
}

function categorize(item, racialRefs) {
  const id = cookbookId(item);
  // A language is declared, never inferred from its name: "Goblin" is a
  // language and a monster and a class restriction, and only the record knows.
  if (
    item.type === "language" ||
    item.flags?.[MODULE_ID]?.extras?.category === "language" ||
    id.startsWith("def.language.")
  ) {
    return "language";
  }
  if (item.flags?.[MODULE_ID]?.training) return "fighting";
  if (id && racialRefs.has(id)) return "racial";
  if (id.startsWith("def.skill.")) return "thief";
  if (id.startsWith("def.power.")) return "powers";
  if ((item.system?.proficiencytype ?? "") === "general") return "general";
  return "class";
}

function bucketLabel(kind, cat) {
  if (cat === "all") return game.i18n.localize(`${LANG_PREFIX}.cattabs.all`);
  if (kind === "abilities") return game.i18n.localize(`${LANG_PREFIX}.cattabs.${cat}`);
  return cat.charAt(0).toUpperCase() + cat.slice(1);
}

/** Inject one filter bar over the rows of `kind` inside their tab panel. */
function wireBar(app, root, doc, kind, isKind, catOf) {
  let rows = [...root.querySelectorAll("[data-item-id]")].filter((r) => {
    const it = doc.items.get(r.dataset.itemId);
    return it && isKind(it);
  });
  if (!rows.length) return;
  const panel = rows[0].closest(".tab") ?? rows[0].parentElement;
  if (!panel || panel.querySelector(`.acks-extras-classes-cattabs[data-kind="${kind}"]`)) return;
  rows = rows.filter((r) => panel.contains(r));
  const present = new Set(rows.map((r) => catOf(doc.items.get(r.dataset.itemId))));
  const cats =
    kind === "abilities"
      ? ["all", ...ABILITY_ORDER.filter((c) => present.has(c))]
      : ["all", ...[...present].sort()];
  if (cats.length <= 2) return; // one bucket splits nothing
  const store = (app.__acksCatTabs ??= {});
  let active = store[kind] ?? "all";
  if (!cats.includes(active)) active = "all";
  const bar = document.createElement("nav");
  bar.className = "acks-extras-classes-cattabs";
  bar.dataset.kind = kind;
  bar.innerHTML = cats
    .map((c) => `<a data-cat="${c}" class="${c === active ? "active" : ""}">${bucketLabel(kind, c)}</a>`)
    .join("");
  const apply = (cat) => {
    for (const r of rows) {
      const it = doc.items.get(r.dataset.itemId);
      r.style.display = cat === "all" || catOf(it) === cat ? "" : "none";
    }
  };
  bar.addEventListener("click", (event) => {
    const a = event.target.closest("a[data-cat]");
    if (!a) return;
    event.preventDefault();
    store[kind] = a.dataset.cat;
    for (const x of bar.querySelectorAll("a")) x.classList.toggle("active", x === a);
    apply(a.dataset.cat);
  });
  panel.prepend(bar);
  apply(active);
}

function onRenderCharacterSheet(app, element) {
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;
  const doc = app.document;
  if (!(doc instanceof Actor) || doc.type !== ACTOR_TYPE.character) return;
  const racialRefs = racialRefsOf(doc);
  wireBar(app, root, doc, "abilities", (it) => it.type === ITEM_TYPE.ability, (it) => categorize(it, racialRefs));
  wireBar(app, root, doc, "spells", (it) => it.type === ITEM_TYPE.spell, (it) => String(it.system?.class || "other").toLowerCase());
}

/** Register the category-tab render hook (called once from classes/module.mjs). */
export function registerSheetTabs() {
  Hooks.on("renderApplicationV2", onRenderCharacterSheet);
}
