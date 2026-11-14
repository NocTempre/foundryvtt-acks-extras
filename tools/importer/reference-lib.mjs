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

/** The ACKS I supplements, on the ACKS shelf. */
export const LIB_ACKSI = "C:\\Proj\\acks-reference\\ACKSI";

/** Community titles written for ACKS, on the ACKS shelf beside the core books. */
export const LIB_COMMUNITY = "C:\\Proj\\acks-reference\\Community";

/** The AXIOMS zine issues and compendia, on the ACKS shelf. */
export const LIB_AXIOMS = "C:\\Proj\\acks-reference\\AXIOMS";

/** Book id -> the exact printing the register's page numbers were read from. */
export const FILES = {
  rr: `${LIB}\\ACKSII_Revised_Rulebook_DIGITAL_FINAL_r10_2nd_Printing.pdf`,
  jj: `${LIB}\\ACKSII_Judges_Journal_DIGITAL_FINAL_r9_2nd_Printing.pdf`,
  mm: `${LIB}\\ACKSII_Monstrous_Manual_DIGITAL_FINAL_r7_2nd_Printing.pdf`,
  tt: `${LIB}\\ACKSII_Treasure_Tome_DIGITAL_r2.pdf`,
  bta: `${LIB}\\ByThisAxe_digital.pdf`,
  ax1: `${LIB_AX}\\AX1Sinister_Stone_of_Sakkara_(hirez).pdf`,
  ax2: `${LIB_AX}\\AX2_Secrets_of_the_Nethercity_-_Bookmarked.pdf`,
  ax3: `${LIB_AX}\\AX3_Capital_of_the_Borderlands.pdf`,
  ax4: `${LIB_AX}\\AX4_Ruined_City_of_Cyfandir.pdf`,
  ax5: `${LIB_AX}\\Autarch_EyrireDreadEye_ACKS_March2019_digital.pdf`,
  ax6: `${LIB_AX}\\AX6_Sepulcher_of_the_Sorceress-Queen.pdf`,
  le: `${LIB_ACKSI}\\AUT_1013_Lairs_and_Encounters_-_Bookmarked.pdf`,
  scg: `${LIB}\\ACKSII_System_Compatibility_Guide_FINAL_r4_2nd_Printing.pdf`,
  axc: `${LIB_AXIOMS}\\AXIOMS_1-8_ACKS_AxiomsCompendium_Bookmarked.pdf`,
};

/**
 * The community titles, by book id.
 *
 * Separate from FILES so `referenceComplete` keeps meaning "the ACKS library is
 * whole" — a community title missing from a machine stops that book's compile,
 * not the family's.
 */
export const COMMUNITY_FILES = {
  cat: `${LIB_COMMUNITY}\\The OSR Catgirl_ Nine Lives of Adventure\\The_OSR_Catgirl.pdf`,
};

/**
 * True only when EVERY book is readable. A partial library still lets the
 * compiler do useful per-book work, but it cannot reproduce the whole cookbook
 * — so the drift check needs the stricter question, not "some book is here".
 */
export const referenceComplete = () => Object.values(FILES).every((f) => fs.existsSync(f));
