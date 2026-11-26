/**
 * What a generated stack's row says of the item its bodies carry, and which body a
 * press on it acts through, as data. A stack whose `gen.carry` names a row of the
 * imported optional-equipment table says "{n} carry {item}" and, where the item is
 * one the carrier runs, offers the press the item's own row offers (Raise, Light
 * or Use). Reading the world (the tokens, the minted item, the live item's state) is
 * the caller's (`carry-press.mjs`); this module decides what the row says and
 * who acts. Foundry-free.
 *
 * A carrier is a roster record stamped with the row (`carries`). The share is
 * spent once a record is stamped, whatever becomes of it, so a press never sends a
 * body that carries nothing: with every slot spent and no stamped body resting or
 * out on the viewed scene, no press is offered.
 */
import { byOrdinal } from "../lib/group-logic.mjs";
import { press as itemRunPress } from "../lib/item-run-row.mjs";

/**
 * The lang prefix of the localizer `carryControls` takes as `say`: lib's item-run
 * words, whose press labels the press builder asks for under `row.press.`.
 */
export const RUN_LANG_PREFIX = "ACKS-LIB.itemRun";

/** The record states a carrier can be in that this module reads. */
const RESTING = "materialized";
const OUT = "deployed";

/** The activation kinds whose press is Raise or Lower (`toggle`) and Light (`fuse`); every other kind's is Use. */
const TOGGLE = "toggle";
const FUSE = "fuse";

/** A share as a count of bodies: a whole number, zero where it is no figure. */
export const shareOf = (n) => (Number.isFinite(Number(n)) ? Math.max(0, Math.floor(Number(n))) : 0);

/**
 * Which body a press on a row acts through, with the stack as it stands.
 *
 *   - `out`: a stamped body whose token is on the viewed scene; its item is used
 *     where it stands (the first of several, by ordinal);
 *   - `rest`: a stamped body resting in the stack, or whose token is gone (the
 *     next send-out frees it); it goes out and then acts;
 *   - `send`: no stamped body is here and a slot of the share is unspent, with a
 *     body at rest to give it to; a send-out stamps and arms it;
 *   - `none`: every slot is spent on bodies that are not here (out on another
 *     scene, fallen, detached), so nothing carries the item that a press could
 *     reach.
 *
 * @param {object} p
 * @param {object[]} p.roster the stack's records
 * @param {string} p.rowKey the `gen.carry` row
 * @param {number} p.share the row's share, as the stack records it
 * @param {number} [p.pristine] living bodies of the stack that hold no record
 * @param {(record: object) => "here"|"elsewhere"|"gone"} p.where where a deployed record's token is, as the viewing seat reads it
 * @returns {{mode: "out"|"rest"|"send"|"none", record: object|null}}
 */
export function chooseCarrier({ roster = [], rowKey, share = 0, pristine = 0, where = () => "elsewhere" }) {
  const stamped = roster.filter((m) => m.carries?.includes(rowKey)).sort(byOrdinal);
  const out = stamped.find((m) => m.state === OUT && where(m) === "here");
  if (out) return { mode: "out", record: out };
  const rest = stamped.find((m) => m.state === RESTING || (m.state === OUT && where(m) === "gone"));
  if (rest) return { mode: "rest", record: rest };
  const unstamped = roster.filter((m) => m.state === RESTING && !m.carries?.includes(rowKey)).length;
  if (stamped.length < shareOf(share) && unstamped + Math.max(0, pristine) > 0) return { mode: "send", record: null };
  return { mode: "none", record: null };
}

/**
 * The press a carried item offers on a stack row: Raise (Lower where the carrier
 * already out holds it raised) for a toggle, Light for a fuse, Use for any other
 * kind, off and saying the item is used up where the live one has none. Null for a kind no runner takes.
 *
 * @param {string} kind the item's activation kind
 * @param {{active: boolean, usedUp: boolean}|null} live the carrier's own item, where a carrier is out on the viewed scene
 * @param {(key: string, data?: object) => string} say the localizer under `ACKS-LIB.itemRun.`
 */
function pressFor(kind, live, say) {
  if (kind === TOGGLE) return itemRunPress(live?.active ? "lower" : "raise", say);
  if (live?.usedUp) return itemRunPress("spent", say, { disabled: true });
  return itemRunPress(kind === FUSE ? "light" : "use", say);
}

/**
 * The controls a stack's row carries for what its bodies carry: one per
 * `gen.carry` row that has a share and names a run item whose kind a runner takes.
 * A row with no share, one the imported table no longer holds and an item with no
 * press give none. A row with no carrier to act, or none this seat would own, keeps
 * its line and draws no press. The line's tooltip says where the share came from: the
 * imported row and its page for a generated stack, the Judge's choice otherwise.
 *
 * @param {object} p
 * @param {{gen?: object, roster?: object[]}} p.stack
 * @param {number} [p.pristine] living bodies of the stack that hold no record
 * @param {(rowKey: string) => {label: string, cite?: string, kind: string|null}|null} p.resolve the row's item label, its page and the kind of its pressable item (null for none)
 * @param {(record: object) => "here"|"elsewhere"|"gone"} p.where
 * @param {(record: object, rowKey: string) => {active: boolean, usedUp: boolean}|null} [p.live] the item an out carrier holds
 * @param {(chosen: {mode: string, record: object|null}) => boolean} [p.owns] whether this seat would own the body that acts (Foundry's own test, never a role); a press is drawn only where it does, and the line stays where it does not
 * @param {(kind: string) => boolean} p.runnable whether a runner is registered for an activation kind
 * @param {(key: string, data?: object) => string} p.say the localizer under `ACKS-LIB.itemRun.`
 * @param {(key: string, data?: object) => string} p.tr the localizer under `ACKS-LIB.group.carry.`
 * @returns {{key: string, rowKey: string, mode: string, line: string, lineTip: string, label: string, tip: string, icon: string, variant: string, disabled: boolean}[]}
 */
export function carryControls({ stack, pristine = 0, resolve, where, live = () => null, owns = () => true, runnable, say, tr }) {
  const out = [];
  const roster = stack?.roster ?? [];
  const generated = !!stack?.gen?.part;
  for (const [rowKey, raw] of Object.entries(stack?.gen?.carry ?? {})) {
    const share = shareOf(raw);
    const row = share ? resolve(rowKey) : null;
    if (!row?.kind || !runnable(row.kind)) continue;
    const chosen = chooseCarrier({ roster, rowKey, share, pristine, where });
    const cite = row.cite || stack.gen.cite || "";
    const lineTip = generated ? `${tr("generated", { item: row.label })}${cite ? ` (${cite})` : ""}` : tr("chosen");
    const base = { key: rowKey, rowKey, mode: chosen.mode, line: tr("line", { n: share, item: row.label }), lineTip, label: "", tip: "", icon: "", variant: "", disabled: false };
    if (chosen.mode === "none" || !owns(chosen)) {
      out.push(base);
      continue;
    }
    const pressed = pressFor(row.kind, chosen.mode === "out" ? live(chosen.record, rowKey) : null, say);
    out.push({ ...base, label: pressed.label, tip: pressed.tip, icon: pressed.icon, variant: pressed.variant, disabled: pressed.disabled });
  }
  return out;
}
