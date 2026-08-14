/* global foundry */
/**
 * The GOODS subtree of a location's market: everything the item-market
 * engine owns. Authored here and composed into `marketSchema()` by
 * location-data.mjs — location owns the schema file, markets owns these
 * fields' semantics and every writer (the GM-routed handlers in
 * scripts/markets/engine/).
 *
 * Campaign state only — availability cells, price steps and transaction
 * counts live in world-imported tables, never here. All money fields are
 * integer copper (1 gp = 100 cp), matching the coin adapter's math.
 *
 * Non-nullable with empty defaults: every ACKS market can trade goods, so
 * the presence of `system.market` is the only gate. Existing worlds need no
 * migration — `clean()` fills a missing `goods` key with these defaults on
 * load (verified live; the offline harness has no DataField mock).
 */
import { num, str, int } from "../../lib/fields.mjs";

const fields = () => foundry.data.fields;

export function goodsSchema() {
  const f = fields();
  return new f.SchemaField({
    // Per-party, per-distinct-item monthly ledger. Rows carry their month
    // start; stale rows are ignored on read and pruned on write. `itemKey`
    // is the case-folded item name — the same distinct-item identity the
    // gear-grant lookup uses, because the RAW cap is per specific item.
    ledger: new f.ArrayField(
      new f.SchemaField({
        partyId: str(),
        itemKey: str(),
        band: str(), // availability band key, denormalized for display
        monthStartTime: int(),
        bought: int(0),
        sold: int(0),
      })
    ),
    // %-cell existence rolls, cached per (party, item, month) so a re-ask
    // can never re-roll the answer.
    existenceRolls: new f.ArrayField(
      new f.SchemaField({
        partyId: str(),
        itemKey: str(),
        monthStartTime: int(),
        exists: new f.BooleanField({ initial: false }),
        detail: str(), // GM-only roll record
      })
    ),
    // Cross-party market totals enforcing the 10× monthly cap. For %-cells
    // the market's whole stock is rolled once per item-month at ten times
    // the cell's chance (230% → 2 units + 30% for a third), floored by any
    // party's own successful existence roll.
    totals: new f.ArrayField(
      new f.SchemaField({
        itemKey: str(),
        band: str(),
        monthStartTime: int(),
        bought: int(0),
        sold: int(0),
        pctStock: int(0),
        pctStockRolled: new f.BooleanField({ initial: false }),
        pctStockDetail: str(), // GM-only roll record
      })
    ),
    // Per-party month state: extended-search days spent (each grants one
    // further increment of the base per-item cap, setting-gated) and the
    // 12+-adventurer dedicated-shopping claim that doubles the month's
    // purchasing power (RR §IV.3).
    partyMonths: new f.ArrayField(
      new f.SchemaField({
        partyId: str(),
        monthStartTime: int(),
        searchDays: int(0),
        dedicated: new f.BooleanField({ initial: false }),
      })
    ),
    // The Judge's-discretion gate on masterwork purchases (RR §IV.6):
    // masterwork gear enters this market's catalog only when the party has
    // the right contact or skilled help here.
    masterworkContact: new f.BooleanField({ initial: false }),
    // GM-set demand modifiers, one per merchandise-type key (config.mjs
    // vocabulary); price shifts one step per point.
    demand: new f.ArrayField(
      new f.SchemaField({
        category: str(),
        modifier: int(0),
      })
    ),
    playersSeeDemand: new f.BooleanField({ initial: false }),
    // Import orders in transit. Arrival and loss are rolled AT PLACEMENT
    // (loss stays hidden until due) so resolution is deterministic under
    // clock adjustments; the processor delivers straight to the buyer.
    imports: new f.ArrayField(
      new f.SchemaField({
        id: str(),
        partyId: str(),
        buyerUuid: str(),
        itemKey: str(),
        itemName: str(),
        qty: int(0),
        unitPriceCp: int(0),
        totalCp: int(0),
        hubShift: num({ integer: true, min: 1, max: 2 }), // +1 local, +2 regional
        placedTime: int(),
        arrivalTime: int(),
        lost: new f.BooleanField({ initial: false }),
        status: new f.StringField({
          required: true,
          initial: "ordered",
          choices: ["ordered", "delivered", "lostRevealed"],
        }),
        rollDetail: str(), // GM-only roll record
        lastResolutionId: str(), // multi-GM-socket claim (candidateField precedent)
      })
    ),
    // Directed searches: a standing ask for one specific item, re-examined
    // at each market month's fresh availability until found (the recruiters
    // analog — the merchant keeps looking so the party need not re-ask).
    searches: new f.ArrayField(
      new f.SchemaField({
        id: str(),
        partyId: str(),
        buyerUuid: str(),
        itemKey: str(),
        itemName: str(),
        qty: int(1),
        createdTime: int(),
        lastRolledMonth: int(0),
        status: new f.StringField({ required: true, initial: "active", choices: ["active", "found", "cancelled"] }),
      })
    ),
    // Item commissions (RR §IV.11): a craftsman builds the item at their
    // construction rate; wages paid up front, delivery at completion.
    commissions: new f.ArrayField(
      new f.SchemaField({
        id: str(),
        buyerUuid: str(),
        itemKey: str(),
        itemName: str(),
        qty: int(1),
        worker: str(), // wageAndConstructionRates row key
        wagesCp: int(0),
        placedTime: int(),
        completionTime: int(),
        status: new f.StringField({ required: true, initial: "building", choices: ["building", "delivered"] }),
        lastResolutionId: str(),
      })
    ),
    // Time-queued dedicated-day venture actions (RR §VIII.6): posted now,
    // resolved by the due-work sweep when their day has passed.
    actions: new f.ArrayField(
      new f.SchemaField({
        id: str(),
        kind: new f.StringField({ required: true, initial: "assess", choices: ["enter", "assess", "solicit"] }),
        partyId: str(),
        actorUuid: str(),
        category: str(), // solicit: merchandise-type key
        cargoSt: int(0), // enter: declared cargo capacity
        postedTime: int(),
        resolveTime: int(),
        status: new f.StringField({ required: true, initial: "pending", choices: ["pending", "done"] }),
        detail: str(),
      })
    ),
    // Venture state per party-month: entered, cargo, impact, toll paid.
    ventures: new f.ArrayField(
      new f.SchemaField({
        partyId: str(),
        monthStartTime: int(),
        cargoSt: int(0),
        impact: int(0),
        effectiveClass: int(0),
        tollCp: int(0),
        entered: new f.BooleanField({ initial: false }),
      })
    ),
    // What each party BELIEVES the demand modifiers to be (assessment
    // results; a false assessment writes wrong numbers it cannot tell apart).
    dmKnowledge: new f.ArrayField(
      new f.SchemaField({
        partyId: str(),
        category: str(),
        believed: int(0),
        time: int(),
      })
    ),
    // The month's rolled market price per merchandise type (step 4 — one
    // price per type per market per month).
    merchPrices: new f.ArrayField(
      new f.SchemaField({
        category: str(),
        monthStartTime: int(),
        priceCp: int(0),
        detail: str(),
      })
    ),
    // Solicited quantities: what a party's day of soliciting opened up,
    // spendable until replaced by a fresh solicitation (fractions carry
    // month-long for the sub-stone merchandise rows).
    solicitations: new f.ArrayField(
      new f.SchemaField({
        partyId: str(),
        category: str(),
        monthStartTime: int(),
        stones: num({ min: 0 }),
      })
    ),
    // Import-arrival watermark for idempotent onTimeAdvanced processing.
    lastProcessedTime: int(0),
  });
}
