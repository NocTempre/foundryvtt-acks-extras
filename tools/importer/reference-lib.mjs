/**
 * Where the LOCAL reference PDFs live, and whether this machine has them.
 *
 * Dev-harness only. The library is licensed material: it is never committed,
 * never shipped, and never present in CI — so every tool that reads it must be
 * able to say "not here" and skip cleanly rather than fail. Kept in one place
 * so the compiler, the acceptance gate and the drift check cannot disagree
 * about which printing they are reading.
 */
import fs from "node:fs";

export const LIB = "C:\\Proj\\acks-reference\\ACKSII";
export const LIB_AX = "C:\\Proj\\acks-reference\\AX";

/**
 * Third-party OSE and B-X adventures, for testing the stat-block grammar
 * against the range of things publishers actually print.
 *
 * Not a list of files, because it is not a fixed set: it is whatever this
 * machine's owner has bought, arranged however they arranged it, and it grows.
 * Tools walk it rather than name anything in it.
 *
 * The same LOCAL-ONLY rules apply as to the ACKS library, and one more that
 * matters more here: a coverage report over this corpus is full of other
 * publishers' stat lines, so no tool may write one into the repo. Report
 * SHAPES, print to stdout, and keep the values on the machine that owns the
 * books.
 */
export const LIB_OSE = "C:\\Proj\\ose-reference";

/** Book id -> the exact printing the register's page numbers were read from. */
export const FILES = {
  rr: `${LIB}\\ACKSII_Revised_Rulebook_DIGITAL_FINAL_r10_2nd_Printing.pdf`,
  jj: `${LIB}\\ACKSII_Judges_Journal_DIGITAL_FINAL_r9_2nd_Printing.pdf`,
  mm: `${LIB}\\ACKSII_Monstrous_Manual_DIGITAL_FINAL_r7_2nd_Printing.pdf`,
  tt: `${LIB}\\ACKSII_Treasure_Tome_DIGITAL_r2.pdf`,
  bta: `${LIB}\\ByThisAxe_digital.pdf`,
  ax2: `${LIB_AX}\\AX2_Secrets_of_the_Nethercity_-_Bookmarked.pdf`,
  ax3: `${LIB_AX}\\AX3_Capital_of_the_Borderlands.pdf`,
  scg: `${LIB}\\ACKSII_System_Compatibility_Guide_FINAL_r4_2nd_Printing.pdf`,
};

/**
 * The authored third-party titles, by book id.
 *
 * Only books that have a cookbook are named here; the rest of the OSE library
 * is walked rather than listed, because it is whatever this machine's owner
 * bought and it grows. Separate from FILES so `referenceComplete` keeps meaning
 * "the ACKS library is whole" — an OSE title missing from a machine stops that
 * book's compile, not the family's.
 */
export const OSE_FILES = {
  qd1: `${LIB_OSE}\\Necrotic Gnome\\Quick Delve _1_ Milk\\Quick_Delve_1_-_Milk.pdf`,
  qd2: `${LIB_OSE}\\Necrotic Gnome\\Quick Delve _2_ The Grotesques' Grotto\\Quick_Delve_2_-_The_Grotesques_Grotto.pdf`,
  qd3: `${LIB_OSE}\\Necrotic Gnome\\Quick Delve _3_ Against the Horselord\\Quick_Delve_3_-_Against_the_Horselord.pdf`,
  aft: `${LIB_OSE}\\Necrotic Gnome\\Old-School Essentials Advanced Fantasy Referee's Tome\\Advanced_Fantasy_Referees_Tome_v1-3.pdf`,
  dmb: `${LIB_OSE}\\Necrotic Gnome\\Dolmenwood Monster Book\\Dolmenwood_Monster_Book.pdf`,
  wld1: `${LIB_OSE}\\Dungeon Age Adventures\\Wicked Little Delves, vol 1\\Wicked-Little-Delves-vol1.pdf`,
  wld2: `${LIB_OSE}\\Dungeon Age Adventures\\Wicked Little Delves, vol 2\\Wicked-Little-Delves-vol2.pdf`,
  wld3: `${LIB_OSE}\\Dungeon Age Adventures\\Wicked Little Delves, vol 3\\Wicked-Little-Delves-vol3.pdf`,
  pc1: `${LIB_OSE}\\Planar Compass\\Planar Compass Issue 1\\PlanarCompass1v1-4.pdf`,
  pc2: `${LIB_OSE}\\Planar Compass\\Planar Compass Issue 2\\PlanarCompass2v2.pdf`,
  pc3: `${LIB_OSE}\\Planar Compass\\Planar Compass Issue 3\\PlanarCompass3_v2_Screen.pdf`,
};

/**
 * True only when EVERY book is readable. A partial library still lets the
 * compiler do useful per-book work, but it cannot reproduce the whole cookbook
 * — so the drift check needs the stricter question, not "some book is here".
 */
export const referenceComplete = () => Object.values(FILES).every((f) => fs.existsSync(f));
