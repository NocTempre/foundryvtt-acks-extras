/**
 * The item sheet's view-model — every decision the sheet makes about what to
 * show, made once, on plain data, with no Foundry in reach.
 *
 * `snapshot.mjs` reads an Item document into the snapshot shape this file
 * consumes; `sheet.mjs` hands the result to the templates. Keeping the
 * decisions here means the tab order, the simple-mode collapse, the pin FIFO,
 * the value badge and the identification gating are all asserted by
 * `tools/test-item-sheet.mjs` rather than discovered in a running world.
 *
 * Shape of the snapshot (see `snapshot.mjs` for the reads behind each field):
 *   identity   id, name, img, type, baseType, description, tags[]
 *   goods      qty (number|null), stackable, weight6, cost
 *   wear       wearable, worn, wornSlot, slotGuess, favorite (bool|null), split
 *   magic      {is, aura, identified}     disguise {enabled, active, trueName,
 *              trueDescription, trueCost, apparentName}
 *   named      {given, trueName, revealed, unlocked, total, cats[], by} | null
 *   container  {holds, capacityStone, load6, cap6, locked, lockMod, quality,
 *              keys[], fragile, accepts[], refusal, contents[], canSee} | null
 *   spellbook  {pagesUsed, pagesCap, groups[]} | null
 *   chart      {sceneName, explored, pct} | null
 *   condition  {labels[], damaged, destroyed, material, acNow, acFull, uses, note}
 *              | null
 *   rolls      groups[{key, name, note, src, rows[{id, m, glyph, v, label,
 *              line, mods[], rollable}]}]
 *   effects    {own[{id,label,detail,when}], inherited[{label,detail,src}]}
 *   price      {lines[], final, apparent}    valueMode "priced"|"unknown"|"na"
 *   variations [{id,name,hidden}]
 *   pins       string[] (roll ids the item pins to its art)
 */
import { DASH, gpLabel, stoneLabel, initialOf, pctLabel } from "./format.mjs";

/** How many rolls the art can carry. */
export const MAX_PINS = 2;
/** Left rail: two identity cells plus the pinned rolls. */
const LEFT_CELLS = 2 + MAX_PINS;
/** Right rail: always four cells tall, dashed pips fill the rest. */
const RIGHT_CELLS = 4;

/** The tab keys in the one order they ever appear. */
export const TAB_ORDER = Object.freeze(["rolls", "chart", "durability", "effects", "contents", "appearance", "details"]);

/** Value modes a Judge picks on the Details tab. */
export const VALUE_MODES = Object.freeze(["priced", "unknown", "na"]);

/** Identification steps, mapped onto the markets feature's three states. */
export const KNOW_STEPS = Object.freeze([
  { n: 1, key: "none" },
  { n: 2, key: "partial" },
  { n: 3, key: "full" },
]);

/** The editor rail's cells: what each edits, and the Font Awesome glyph it wears. */
const EDITOR_CELLS = Object.freeze([
  { key: "editDescription", icon: "fa-solid fa-pen-to-square" },
  { key: "changeArt", icon: "fa-solid fa-image" },
  { key: "editTags", icon: "fa-solid fa-tags" },
  { key: "ownership", icon: "fa-solid fa-user-lock", worldOnly: true },
  { key: "source", icon: "fa-solid fa-book-open", gmOnly: true },
]);

/**
 * Pin ids the item carries, bounded to rolls that still exist; the first two
 * rolls in document order stand in when nothing is pinned.
 */
export function effectivePins(pins, rollIds) {
  const kept = (Array.isArray(pins) ? pins : []).filter((id) => rollIds.includes(id)).slice(-MAX_PINS);
  return kept.length ? kept : rollIds.slice(0, MAX_PINS);
}

/**
 * Toggle a pin. Pinning a third unpins the oldest — FIFO, so the art always
 * shows the two most recent choices.
 */
export function togglePin(pins, rollIds, id) {
  const cur = effectivePins(pins, rollIds);
  const at = cur.indexOf(id);
  if (at !== -1) {
    cur.splice(at, 1);
    return cur;
  }
  if (cur.length >= MAX_PINS) cur.shift();
  cur.push(id);
  return cur;
}

/**
 * Which tab survives when the current one disappears: the same one if it is
 * still there, else the first available.
 */
export function resolveTab(active, available) {
  if (available.includes(active)) return active;
  return available[0] ?? null;
}

/**
 * What the value badge reads, and why — one rule for the band, the ledger and
 * the tooltip.
 * @returns {{text:string, reason:string}}
 */
export function valueBadge({ mode, fullCost, apparentCost, hideMagic, masked, maskedForJudge }) {
  if (mode === "unknown") return { text: null, reason: "unknown" };
  if (mode === "na") return { text: DASH, reason: "na" };
  if (hideMagic) return { text: gpLabel(apparentCost ?? fullCost), reason: "apparent" };
  if (masked) return { text: gpLabel(fullCost), reason: "maskValue" };
  if (maskedForJudge) return { text: gpLabel(fullCost), reason: "trueValue" };
  return { text: gpLabel(fullCost), reason: "value" };
}

/**
 * Build the render context.
 * @param {object} snap the item snapshot (shape above)
 * @param {object} viewer
 * @param {boolean} viewer.isGM
 * @param {boolean} viewer.editable
 * @param {boolean} [viewer.previewAsPlayer]  a Judge looking through a player's eyes
 * @param {string|null} [viewer.activeTab]
 * @param {boolean} [viewer.showDetails]      simple mode's one unfolded panel
 * @param {boolean} [viewer.editingDescription]
 */
export function buildItemSheetModel(snap, viewer = {}) {
  const gm = !!viewer.isGM && !viewer.previewAsPlayer;
  const magic = snap.magic ?? { is: false, aura: null, identified: "full" };
  const know = magic.is ? (KNOW_STEPS.find((s) => s.key === magic.identified)?.n ?? 1) : 3;
  const hideMagic = !gm && magic.is && know < 3;
  const showAura = gm || !magic.is || know >= 2;
  const dis = snap.disguise ?? { enabled: false, active: false };
  // A player looking at a disguised item sees the document, which IS the mask.
  const masked = !gm && dis.active;
  const maskedForJudge = gm && dis.active;

  /* ---- rolls and pins ------------------------------------------------- */
  const groups = masked ? [] : snap.rolls ?? [];
  const flat = groups.flatMap((g) => g.rows.map((r) => ({ ...r, group: g.key })));
  const rollIds = flat.map((r) => r.id);
  const pins = effectivePins(snap.pins, rollIds);
  const pinnedRows = pins.map((id) => flat.find((r) => r.id === id)).filter(Boolean);
  const overflow = Math.max(0, flat.length - pinnedRows.length);

  /* ---- what exists ---------------------------------------------------- */
  const container = snap.container && !masked ? snap.container : null;
  const spellbook = snap.spellbook && !masked ? snap.spellbook : null;
  const holds = !!(container?.holds || spellbook);
  const dur = snap.condition && !masked ? snap.condition : null;
  const named = snap.named && !masked ? snap.named : null;
  const chart = snap.chart && !masked ? snap.chart : null;
  const ownEffects = masked || hideMagic ? [] : snap.effects?.own ?? [];
  const inherited = masked ? [] : snap.effects?.inherited ?? [];
  const effectCount = ownEffects.length + inherited.length + (named ? 1 : 0);

  const tabDefs = [];
  tabDefs.push({ key: "rolls", count: flat.length || null });
  if (chart) tabDefs.push({ key: "chart", count: null });
  if (dur) tabDefs.push({ key: "durability", count: null });
  tabDefs.push({ key: "effects", count: effectCount || null });
  if (holds) tabDefs.push({ key: "contents", count: (container?.contents?.length ?? spellbook?.count ?? 0) || null });
  if (gm && (dis.enabled || dis.active || magic.is)) tabDefs.push({ key: "appearance", count: null });
  tabDefs.push({ key: "details", count: null });
  const available = tabDefs.map((t) => t.key);
  const activeTab = resolveTab(viewer.activeTab, available);

  const simple = !flat.length && !effectCount && !holds && !named && !dur && !chart;

  /* ---- title band ----------------------------------------------------- */
  const qty = snap.stackable && Number.isFinite(snap.qty) ? snap.qty : null;
  const isStack = qty !== null && qty > 1;
  const fullCost = snap.price?.final ?? snap.cost ?? 0;
  const value = valueBadge({
    mode: snap.valueMode ?? "priced",
    fullCost,
    apparentCost: snap.price?.apparent ?? null,
    hideMagic,
    masked,
    maskedForJudge,
  });
  const condState = dur?.destroyed ? "destroyed" : dur?.damaged ? "damaged" : null;
  // Damage cannot be disguised: the tag reads off the real condition even
  // when the rest of the sheet is the mask.
  const bandState = snap.condition?.destroyed ? "destroyed" : snap.condition?.damaged ? "damaged" : null;

  /* ---- left rail ------------------------------------------------------ */
  const typeCell = {
    icon: snap.typeIcon ?? { kind: "svg", value: "icons/svg/item-bag.svg" },
    label: snap.typeShort ?? "",
    title: snap.typeTitle ?? "",
  };
  const slotCell = { icon: snap.slotIcon ?? "fa-solid fa-hand-holding", label: snap.slotShort ?? DASH, title: snap.slotTitle ?? "" };
  const rollCells = pinnedRows.map((r) => ({
    id: r.id,
    glyph: r.glyph ?? null,
    m: r.glyph ? null : r.m,
    v: r.v ?? DASH,
    title: `${r.label} — ${r.line}`,
    rollable: !!r.rollable,
  }));
  const leftPads = Math.max(0, LEFT_CELLS - 2 - rollCells.length);

  /* ---- right rail ----------------------------------------------------- */
  const rightCells = [];
  if (!simple) {
    if (snap.wearable) {
      if (isStack && !snap.split) {
        rightCells.push({ key: "split", m: "EQP", v: DASH, on: false, title: "splitHint" });
      } else if (snap.split) {
        rightCells.push({ key: "restack", m: snap.slotShort ?? "EQP", v: "1", on: true, title: "restackHint" });
      } else {
        rightCells.push({ key: "equip", m: "EQP", v: snap.worn ? snap.slotShort ?? "On" : DASH, on: !!snap.worn, title: "equipHint" });
      }
    }
    if (snap.favorite !== null && snap.favorite !== undefined) {
      rightCells.push({ key: "favorite", m: "PIN", v: snap.favorite ? "Yes" : DASH, on: !!snap.favorite, title: "favoriteHint" });
    }
    if (container?.holds) {
      const ratio = container.cap6 ? container.load6 / container.cap6 : 0;
      rightCells.push({ key: "capacity", m: "CAP", v: container.cap6 ? pctLabel(ratio) : stoneLabel(container.load6), on: false, pct: pctLabel(ratio), title: "capacityHint" });
    }
    if (container?.locked) {
      rightCells.push({ key: "lock", m: "LOCK", icon: "icons/svg/padlock.svg", v: container.lockMod ? (container.lockMod > 0 ? `+${container.lockMod}` : `−${Math.abs(container.lockMod)}`) : DASH, on: true, title: "lockHint" });
    }
  }
  const rightPads = Math.max(0, RIGHT_CELLS - rightCells.length);

  /* ---- editor rail ---------------------------------------------------- */
  const editorCells = EDITOR_CELLS.filter((c) => (!c.worldOnly || !snap.embedded) && (!c.gmOnly || gm)).map((c) => ({
    key: c.key,
    icon: c.icon,
    on: c.key === "editDescription" && !!viewer.editingDescription,
  }));

  /* ---- tabs ------------------------------------------------------------ */
  const tabs = tabDefs.map((t) => ({ key: t.key, count: t.count, active: t.key === activeTab }));

  /* ---- aura ------------------------------------------------------------ */
  const aura = magic.is && magic.aura && showAura ? magic.aura : null;

  /* ---- named pips ---------------------------------------------------- */
  const namedView = named
    ? {
        ...named,
        pips: Array.from({ length: named.total }, (_, i) => ({ lit: i < named.unlocked })),
      }
    : null;

  /* ---- contents ------------------------------------------------------- */
  const contentsView = container
    ? {
        ...container,
        capLine: container.cap6 ? `${stoneLabel(container.load6)} of ${stoneLabel(container.cap6)}` : stoneLabel(container.load6),
        capPct: container.cap6 ? pctLabel(container.load6 / container.cap6) : "0%",
        over: !!container.cap6 && container.load6 > container.cap6,
        acceptsAny: !container.accepts?.length,
        contents: (container.contents ?? []).map((c) => ({ ...c, initial: initialOf(c.name), wt: stoneLabel(c.weight6) })),
      }
    : null;

  return {
    gm,
    editable: !!viewer.editable,
    previewAsPlayer: !!viewer.previewAsPlayer,
    simple,
    showDetails: simple && !!viewer.showDetails,
    tabs,
    activeTab,
    band: {
      name: maskedForJudge ? dis.trueName : snap.name,
      nameMasked: maskedForJudge,
      qty,
      // The stack's own count: splitting one out already decremented it, and
      // the split item is a separate document with a count of one.
      qtyShown: isStack && !masked ? qty : null,
      scene: chart ? chart.sceneName : null,
      condition: bandState,
      value: value.text,
      valueReason: value.reason,
      valueUnknown: value.reason === "unknown",
      weight: stoneLabel(snap.weight6),
      weight6: snap.weight6,
      masked: maskedForJudge,
      striped: maskedForJudge,
    },
    art: {
      img: snap.img,
      initial: initialOf(snap.name),
      aura,
      struck: !!snap.condition?.destroyed,
      more: overflow > 0 ? `+${overflow}` : null,
    },
    rails: {
      type: typeCell,
      slot: slotCell,
      rolls: rollCells,
      leftPads: Array.from({ length: leftPads }),
      right: rightCells,
      rightPads: Array.from({ length: rightPads }),
      editor: editorCells,
    },
    description: maskedForJudge ? dis.trueDescription : snap.description,
    descriptionSource: maskedForJudge ? dis.trueDescriptionSource : snap.descriptionSource,
    editingDescription: !!viewer.editingDescription,
    tags: snap.tags ?? [],
    rolls: {
      groups: groups.map((g) => ({
        ...g,
        rows: g.rows.map((r) => ({ ...r, pinned: pins.includes(r.id) })),
      })),
      empty: flat.length === 0,
    },
    chart: chart ? { ...chart, pctLabel: pctLabel(chart.pct) } : null,
    durability: dur
      ? {
          ...dur,
          conditionLabel: dur.labels?.length ? dur.labels.join("; ") : null,
          acLine: dur.acNow !== null && dur.acNow !== undefined ? { now: dur.acNow, full: dur.acFull } : null,
          lock: container?.holds || container?.locked || container?.lockMod ? container : null,
        }
      : null,
    effects: {
      own: ownEffects,
      inherited,
      hiddenByIdentification: hideMagic && (snap.effects?.own?.length ?? 0) > 0,
      named: namedView,
      // A Judge may name ordinary arms or armour while the overlay is on.
      namedOffered: gm && !named && !!snap.namedOffered,
    },
    contents: contentsView,
    spellbook: spellbook
      ? {
          ...spellbook,
          over: spellbook.pagesUsed > spellbook.pagesCap,
          pct: pctLabel(spellbook.pagesCap ? spellbook.pagesUsed / spellbook.pagesCap : 0),
        }
      : null,
    appearance: gm
      ? {
          magic: magic.is,
          aura: magic.aura ?? "",
          know,
          steps: KNOW_STEPS.map((s) => ({ ...s, on: s.n === know })),
          disguisable: !!dis.enabled,
          disguised: !!dis.active,
          mask: dis.active ? { name: dis.apparentName, initial: initialOf(dis.apparentName), description: dis.apparentDescription, img: dis.apparentImg } : null,
        }
      : null,
    details: {
      price: {
        ...(snap.price ?? { lines: [], final: 0 }),
        lines: (snap.price?.lines ?? []).map((l) => ({ ...l, runningLabel: gpLabel(l.running) })),
        finalLabel: gpLabel(snap.price?.final ?? 0),
      },
      valueMode: snap.valueMode ?? "priced",
      valueModes: VALUE_MODES.map((k) => ({ key: k, on: (snap.valueMode ?? "priced") === k })),
      variations: snap.variations ?? [],
      holds: !!container?.holds,
      capacityStone: container?.capacityStone ?? null,
      accepts: container?.accepts ?? [],
      acceptChips: (snap.acceptKinds ?? []).map((k) => ({ key: k, on: (container?.accepts ?? []).includes(k) })),
      refusal: container?.refusal ?? "",
      disguisable: !!dis.enabled,
      identifyOffered: !gm && magic.is && know < 3 && !!viewer.editable,
    },
    record: snap.record ?? null,
    masked,
    hideMagic,
  };
}
