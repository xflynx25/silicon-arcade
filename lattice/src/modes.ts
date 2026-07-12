export type ModeId = "territory" | "conquest";

export const CONTROLS =
  "P1  ·  W A S D steer  ·  hold Left Shift boost\n" +
  "P2  ·  Arrow keys steer  ·  hold Right Shift boost\n" +
  "Leave your land to draw a line — loop back to claim it.";

export const MODE_LABEL: Record<ModeId, string> = {
  territory: "TERRITORY",
  conquest: "CONQUEST"
};

export const MODE_TITLE_LINE: Record<ModeId, string> = {
  territory: "  1  TERRITORY  — 90 seconds; most ground wins",
  conquest: "  2  CONQUEST   — first to hold 60% of the grid"
};

export const MODE_HELP: Record<ModeId, string> = {
  territory:
    "Claim the most ground before the clock runs out.\n" +
    "Steer out of your land to trail a line, then loop\n" +
    "back in — everything you enclose is captured, even\n" +
    "cells stolen from your rival. Cut across their line\n" +
    "to send them home and erase their claim.",
  conquest:
    "Race to hold 60% of the grid — no clock, pure land\n" +
    "grab. Bigger loops claim more but leave your line\n" +
    "exposed. Slam across your rival's trail to reset\n" +
    "them to a tiny home block and swing the momentum."
};
