/**
 * `bindVehicleRow` — one printed table row as a vehicle actor.
 *
 * What this pins is the READING of the table's own conventions: a slashed pair
 * is normal-then-heavy and becomes two speed tiers, a parenthesised cargo
 * figure is the passengers-or-cargo trade, and a crew column is a complement,
 * a driver-plus-warriors split, or a choice between two passenger counts.
 *
 * No book text or values are reproduced. The rows below are shaped like the
 * printed ones with invented numbers.
 */
import assert from "node:assert";
import { bindVehicleRow, rowClaimKey } from "../../scripts/importer/cookbook.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

const entry = { book: "rr", cite: "RR p.999", icon: "icons/svg/stone-path.svg" };
const row = (label, cells) => ({ key: "x", label, cells });
const build = (label, cells) => bindVehicleRow(row(label, cells), entry, "def.vehicle.landTable");

/* A cart: one driver, a slashed speed and a slashed cargo. */
const cart = build("cart, Big (1 heavy horse)", {
  crew: "1", movement: "70’/35’", expedition: "14 / 7", cargo: "90 / 130", ac: 0, shp: 4, cost: "55gp",
});
check("it is an actor sub-type, not an item", cart.type === "acks-extras.vehicle");
check("the label becomes the name, small-cap initial restored", cart.name === "Cart, Big (1 heavy horse)");
check("land is the kind", cart.system.kind === "land");
check("capacity is the NORMAL figure", cart.system.cargo.capacityStone === 90);
check("two printed pairs become two tiers", cart.system.speeds.tiers.length === 2);
check("the normal tier pairs load with speed", cart.system.speeds.tiers[0].maxLoadStone === 90 && cart.system.speeds.tiers[0].feetPerTurn === 70);
check("the heavy tier is the slower one", cart.system.speeds.tiers[1].maxLoadStone === 130 && cart.system.speeds.tiers[1].feetPerTurn === 35);
check("a lone crew figure is the driver", cart.system.crew.roles.length === 1 && cart.system.crew.roles[0].required === 1);
check("the driver is motive", cart.system.crew.roles[0].motive === true);
check("ac is carried", cart.system.ac === 0);
check("shp fills value and max", cart.system.shp.value === 4 && cart.system.shp.max === 4);

/* A chariot: driver plus warriors. */
const chariot = build("chariot, Big (4 light horses)", {
  crew: "1 + 3", movement: "100’/50’", cargo: "70 / 140", ac: 2, shp: 2,
});
check("a plus splits into two roles", chariot.system.crew.roles.length === 2);
check("the driver comes first", chariot.system.crew.roles[0].key === "driver" && chariot.system.crew.roles[0].required === 1);
check("warriors are the second role", chariot.system.crew.roles[1].required === 3);
check("warriors are NOT motive", chariot.system.crew.roles[1].motive === false);

/* A howdah: a choice of passenger counts, and cargo in parentheses. */
const howdah = build("Howdah,riding (huge creature)", {
  crew: "2 or 4", movement: "By creature", expedition: "By creature", cargo: "(7)", ac: 0, shp: 1,
});
check("a comma losing its space at a line break is repaired", howdah.name === "Howdah, riding (huge creature)");
check("a choice fills passengers, not a crew role", howdah.system.cargo.passengers === 2);
check("a howdah gets no crew roles", howdah.system.crew === undefined);
check("the parenthesised figure is still the capacity", howdah.system.cargo.capacityStone === 7);
check("a trading vehicle gets no speed tiers", howdah.system.speeds === undefined);

/* Degenerate rows must not throw or invent. */
const bare = build("Sledge", {});
check("a bare row still names the vehicle", bare.name === "Sledge");
check("a bare row has no cargo", bare.system.cargo === undefined);
check("a bare row has no crew", bare.system.crew === undefined);
check("a bare row has no tiers", bare.system.speeds === undefined);

const noPair = build("Barrow", { crew: "1", movement: "40’", cargo: "20" });
check("a single figure yields one tier", noPair.system.speeds.tiers.length === 1);
check("that tier keeps the only speed", noPair.system.speeds.tiers[0].feetPerTurn === 40);

/* The dedup claim must tell apart rows the grid's own key cannot. The grid
   keys on slugLabel, which drops the parenthetical — and the parenthetical is
   load-bearing here: it names the team and it changes the cargo. Three
   vehicles went missing in a live import because the claim used that key, and
   nothing offline noticed because the grid itself returned all the rows. */
const sameKey = (label) => rowClaimKey({ key: "cartLarge", label });
check(
  "two teams of one vehicle claim differently",
  sameKey("Cart, Large (1 heavy horse)") !== sameKey("Cart, Large (2 heavy horses)"),
);
check("a claim folds punctuation away", rowClaimKey({ label: "Cart, Large (1 heavy horse)" }) === "cart-large-1-heavy-horse");
check(
  "wagons differing only by team differ",
  rowClaimKey({ key: "wagon", label: "Wagon (2 heavy horses)" }) !== rowClaimKey({ key: "wagon", label: "Wagon (4 heavy horses)" }),
);
check("a row with no label falls back to its key", rowClaimKey({ key: "sledge" }) === "sledge");
check("an empty row still yields a claim", rowClaimKey({}) === "row");

/* The SEA table: three role complements, named sea speeds, single cargo.
   Shaped like the printed rows with invented numbers, as above. */
const seaEntry = { book: "rr", cite: "RR p.999", icon: "icons/svg/anchor.svg", meta: { category: "vehicle", kindOfVehicle: "sea" } };
const sea = (label, cells) => bindVehicleRow(row(label, cells), seaEntry, "def.vehicle.seaTable");

const galley = sea("galley, 9-rower", {
  sailors: "7", rowers: "111", marines: "22",
  oarSprint: "260’", oarCruise: "220’", oarSlow: "110’", sail: "230’",
  voyageOar: "44", voyageSail: "88", cargo: "1,700", ac: 2, shp: "45", cost: "9,999gp",
});
check("meta routes the row to the sea binder", galley.system.kind === "sea");
check("three crew columns become three roles", galley.system.crew.roles.length === 3);
check("sailors and rowers are motive", galley.system.crew.roles[0].motive === true && galley.system.crew.roles[1].motive === true);
check("marines are not", galley.system.crew.roles[2].motive === false);
check("complements land as required, nobody aboard", galley.system.crew.roles[1].required === 111 && galley.system.crew.roles[1].aboard === 0);
check("feet marks strip from combat speeds", galley.system.speeds.oarSprint === 260 && galley.system.speeds.sail === 230);
check("voyage speeds land on the voyage fields", galley.system.speeds.voyageOar === 44 && galley.system.speeds.voyageSail === 88);
check("a thousands separator does not split the hold", galley.system.cargo.capacityStone === 1700);
check("no tiers on a vessel", galley.system.speeds.tiers === undefined);
check("shp fills value and max", galley.system.shp.value === 45 && galley.system.shp.max === 45);

const sailer = sea("Sailing Ship, Middling", {
  sailors: "13", rowers: "-", marines: "-", oarSprint: "-", oarCruise: "-", oarSlow: "-",
  sail: "210’", voyageOar: "-", voyageSail: "84", cargo: "12,000", ac: 2, shp: "80",
});
check("a dash is an absent role, not a zero", sailer.system.crew.roles.length === 1 && sailer.system.crew.roles[0].key === "sailors");
check("a dash is an absent speed too", sailer.system.speeds.oarSprint === undefined && sailer.system.speeds.sail === 210);

const rowboat = sea("Boat,row", { rowers: "1", oarSprint: "200’", voyageOar: "28", cargo: "90", ac: 1, shp: "2" });
check("the sea table's Title Case survives the small-cap comma", rowboat.name === "Boat, Row");

const longboat = sea("Longboat", {
  sailors: "14", rowers: "55", marines: "(70)",
  oarSprint: "200’", oarCruise: "140’", oarSlow: "80’", sail: "230’",
  voyageOar: "28", voyageSail: "84", cargo: "1,900", ac: 2, shp: "28",
});
check("a parenthesised marine allowance still binds as the bench", longboat.system.crew.roles[2].required === 70);

console.log(`test-vehicles: all ${pass} checks passed`);
