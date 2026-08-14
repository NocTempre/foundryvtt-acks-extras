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
        // The 12+-adventurer dedicated-shopping doubling, claimed once per
        // party per month; stamped on every row of that party's month.
        doubled: new f.BooleanField({ initial: false }),
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
    // Cross-party market totals enforcing the 10× monthly cap.
    totals: new f.ArrayField(
      new f.SchemaField({
        itemKey: str(),
        band: str(),
        monthStartTime: int(),
        bought: int(0),
        sold: int(0),
      })
    ),
    // Extended-search days spent this month per party; each grants one
    // further increment of the base per-item cap (setting-gated).
    searchDays: new f.ArrayField(
      new f.SchemaField({
        partyId: str(),
        monthStartTime: int(),
        days: int(0),
      })
    ),
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
    // Import-arrival watermark for idempotent onTimeAdvanced processing.
    lastProcessedTime: int(0),
  });
}
