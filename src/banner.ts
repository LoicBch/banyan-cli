/**
 * ASCII-art banner shown when `bn` is invoked without arguments.
 *
 * Layout:
 *   - irregular banyan tree canopy (asymmetric lobes, leaf-density variation,
 *     hanging leaflets) — dense dark-green palette
 *   - thick massive aerial-root trunks underneath (banyan's signature)
 *   - "banyan" ANSI-shadow block lettering
 *   - version + tagline
 *
 * Rendered with ANSI dark-green tones; gracefully degrades to plain text if
 * the terminal does not support color (NO_COLOR) or output is not a TTY.
 */

import { packageVersion } from "./version.js";

const RESET = "\x1b[0m";
const FOLIAGE_DARK = "\x1b[38;5;22m"; // very dark green — edges, shadows
const FOLIAGE = "\x1b[38;5;28m"; // dark green — main body
const FOLIAGE_BRIGHT = "\x1b[38;5;34m"; // forest green — highlights
const TRUNK = "\x1b[38;5;94m"; // brown — main aerial roots
const TRUNK_DARK = "\x1b[38;5;52m"; // darker brown — old massive trunks
const GROUND = "\x1b[2;38;5;240m"; // dim grey ground
const TEXT = "\x1b[38;5;42m"; // banyan name in lively green
const DIM = "\x1b[2m";

const VERSION = packageVersion();

function noColor(): boolean {
  return Boolean(process.env.NO_COLOR) || !process.stdout.isTTY;
}

function c(s: string, color: string): string {
  if (noColor()) return s;
  return color + s + RESET;
}

/** Multi-segment line builder so we can paint a row in mixed colors. */
function row(...segments: Array<[string, string] | string>): string {
  return segments
    .map((s) => (typeof s === "string" ? s : c(s[0], s[1])))
    .join("");
}

export function printBanner(): void {
  const F = FOLIAGE;
  const FB = FOLIAGE_BRIGHT;
  const FD = FOLIAGE_DARK;
  const T = TRUNK;
  const T2 = TRUNK_DARK;

  const lines = [
    "",
    // canopy — asymmetric lobes, dark base with darker edges (7 rows)
    row("                ", ["░▒▓▓▒░", FD], "         ", ["░▒▒▓▒░", FD]),
    row("            ", ["░▒▓▓▓▓▓▓", F], ["▒▓▓▓▒▒▒▓▓▓▒", FD], ["▓▓▓▓▓▒░", F]),
    row("          ", ["░▒▓▓", F], ["██", FB], ["▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓", F], ["██", FB], ["▓▓▓▒", F]),
    row("        ", ["▒▓▓▓▓▓▓▓▓▓▓▓", F], ["██", FB], ["▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒", F]),
    row("       ", ["▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓", F], ["██", FB], ["▓▓▓▓▓▓▓▓", F]),
    row("      ", ["▓▓", F], ["██", FB], ["▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓", F]),
    row("      ", ["▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒", F]),
    // hanging leaflets in the very dark shade
    row("            ", ["░░░  ░ ░░░ ░ ░░░  ░░░", FD]),
    // aerial roots — massive, thick, varied (3 rows, shorter than before)
    row(
      "             ",
      ["┃┃", T],
      "    ",
      ["███", T2],
      "    ",
      ["┃┃", T],
      "   ",
      ["█████", T2],
      "   ",
      ["┃┃", T],
    ),
    row(
      "             ",
      ["┃┃", T],
      "   ",
      ["╱███", T2],
      "    ",
      ["┃┃", T],
      "   ",
      ["█████", T2],
      "   ",
      ["┃┃", T],
      "    ",
      ["╲╲", T],
    ),
    row(
      "             ",
      ["┃┃", T],
      "    ",
      ["███", T2],
      "    ",
      ["┃┃", T],
      "   ",
      ["█████", T2],
      "   ",
      ["┃┃", T],
      "     ",
      ["╲╲", T],
    ),
    // ground — wide enough to accommodate the splayed outer root
    c("          ══╩╩════╩╩╩════╩╩═══╩╩╩╩╩═══╩╩══════╩╩", GROUND),
    "",
    // banyan ANSI-shadow lettering
    c("  ██████╗  █████╗ ███╗   ██╗██╗   ██╗ █████╗ ███╗   ██╗", TEXT),
    c("  ██╔══██╗██╔══██╗████╗  ██║╚██╗ ██╔╝██╔══██╗████╗  ██║", TEXT),
    c("  ██████╔╝███████║██╔██╗ ██║ ╚████╔╝ ███████║██╔██╗ ██║", TEXT),
    c("  ██╔══██╗██╔══██║██║╚██╗██║  ╚██╔╝  ██╔══██║██║╚██╗██║", TEXT),
    c("  ██████╔╝██║  ██║██║ ╚████║   ██║   ██║  ██║██║ ╚████║", TEXT),
    c("  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═══╝", TEXT),
    "",
    c(`         v${VERSION}  ·  tmux × git worktrees × Claude Code`, DIM),
    "",
  ];
  process.stdout.write(lines.join("\n") + "\n");
}
