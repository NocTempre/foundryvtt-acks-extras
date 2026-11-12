/** The registry split: what the module offers (`BOOKS`) against what it knows (`REGISTRY`). No PDFs, no Foundry. */
import assert from "node:assert";
import { BOOKS, OSE_BOOKS_ACTIVE, REGISTRY, activeBooks, bookIsJudges, bookLine, citeFor, offeredBookFiles, parseCite, registryBookOf } from "../../scripts/importer/books.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

const OSE = ["qd1", "qd2", "qd3", "aft", "dmb", "wld1", "wld2", "wld3", "pc1", "pc2", "pc3"];
const KEPT = ["cat", "mm", "rr", "jj", "ax1"];

const on = activeBooks(REGISTRY, true);
check("with the switch on every key is offered", Object.keys(on).length === Object.keys(REGISTRY).length && Object.keys(REGISTRY).every((id) => id in on));
check("with the switch on the entries are the registry's own", Object.keys(on).every((id) => on[id] === REGISTRY[id]));

const off = activeBooks(REGISTRY, false);
const dropped = Object.keys(REGISTRY).filter((id) => !(id in off));
check("with the switch off exactly the OSE books are dropped", dropped.length === OSE.length && OSE.every((id) => dropped.includes(id)));
check("with the switch off the ACKS-native books stay", KEPT.every((id) => id in off));
check("with the switch off the registry order is kept", Object.keys(off).join() === Object.keys(REGISTRY).filter((id) => !OSE.includes(id)).join());
check("activeBooks leaves its input whole", OSE.every((id) => id in REGISTRY));

check("every entry declaring stats declares ose", Object.values(REGISTRY).every((b) => b.stats === undefined || b.stats === "ose"));
check("the declared set is the OSE set", Object.keys(REGISTRY).filter((id) => REGISTRY[id].stats === "ose").sort().join() === [...OSE].sort().join());
check("a book from a line of its own can still be ACKS-native", REGISTRY.cat.line && REGISTRY.cat.stats === undefined);

check("BOOKS is the registry as the switch leaves it", Object.keys(BOOKS).join() === Object.keys(activeBooks(REGISTRY, OSE_BOOKS_ACTIVE)).join());

for (const id of dropped) {
  check(`a dropped ${id} still answers its line`, bookLine(id) === (REGISTRY[id].line ?? null));
  check(`a dropped ${id} still answers whether it is the Judge's`, bookIsJudges(id) === (REGISTRY[id].judge === true));
  check(`a dropped ${id} still cites`, citeFor(id, 5).startsWith(REGISTRY[id].short));
  check(`a dropped ${id} still parses from its citation`, parseCite(citeFor(id, 5))?.book === id);
}

/* The offered-set reads, on invented ids so the result owes nothing to which
 * real books are switched on: a registry of three, one of them withdrawn. */
{
  const invented = { zza: { stats: "ose" }, zzb: {}, zzc: {} };
  const offered = activeBooks(invented, false);
  check("the invented registry withdraws exactly the declared book", !("zza" in offered) && "zzb" in offered && "zzc" in offered);

  const listed = ["zza", "zzb", "zzc", "zzb"];
  check("a listed book the registry knows and the offered set lacks is not a file to fetch", offeredBookFiles(listed, offered, invented).join() === "zzb,zzc,zzb");
  check("an index's order is kept", offeredBookFiles(["zzc", "zzb"], offered, invented).join() === "zzc,zzb");
  check("with everything offered every listed file is fetched", offeredBookFiles(listed, invented, invented).join() === listed.join());
  check("with nothing offered no known book is fetched", offeredBookFiles(listed, {}, invented).length === 0);
  check("a listed id the registry does not know is kept, as a claim naming no known book is offered", offeredBookFiles(["zzx", "zza"], offered, invented).join() === "zzx");
  check("with no index every offered book is probed", offeredBookFiles(null, offered, invented).join() === "zzb,zzc");
  check("an absent index is no index", offeredBookFiles(undefined, offered, invented).join() === "zzb,zzc");
  check("an empty index lists nothing", offeredBookFiles([], offered, invented).length === 0);

  check("an id names its book by its first segment", registryBookOf("zza.entry.7", invented) === "zza");
  check("a bare book id names that book", registryBookOf("zzb", invented) === "zzb");
  check("an id of a book the registry lacks names none", registryBookOf("zzx.entry", invented) === null);
  check("a content id names no book", registryBookOf("def.thing", invented) === null);
  check("a prototype key names no book", registryBookOf("constructor.x", invented) === null);
  check("an empty or missing id names no book", registryBookOf("", invented) === null && registryBookOf(undefined, invented) === null && registryBookOf(".x", invented) === null);
  check("a book the offered set withdrew is still named", registryBookOf("zza.entry", invented) === "zza" && !("zza" in offered));
  check("the default registry is the real one", registryBookOf(`${Object.keys(REGISTRY)[0]}.x`) === Object.keys(REGISTRY)[0]);
  check("the real registry's ids filter down to the offered books, in order", offeredBookFiles(Object.keys(REGISTRY), BOOKS).join() === Object.keys(BOOKS).join());
}

// A citation names the printed folio, so it is composed by `citeFor` alone: an
// importer that interpolates a table's page into "<short> p. <page>" cites the
// PDF page, past the folio by the book's offset.
{
  const { readFileSync, readdirSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "importer");
  const raw = /\.short \?\? "[A-Za-z0-9]+"\} p\. \$\{/;
  const offenders = readdirSync(dir).filter((f) => f.endsWith(".mjs") && raw.test(readFileSync(join(dir, f), "utf8")));
  check(`no importer file composes a citation from a raw page (${offenders.join(", ") || "none"})`, offenders.length === 0);
  check("a citation names the folio, not the PDF page", citeFor("rr", 10) === `${REGISTRY.rr.short} p.${10 - (REGISTRY.rr.printedOffset ?? 0)}`);
}

console.log(`\ntest-book-registry: all ${pass} checks passed`);
