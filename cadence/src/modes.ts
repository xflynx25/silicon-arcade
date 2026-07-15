export type ModeId = "trade" | "clash";

export const CONTROLS =
  "P1  ·  A S D W = lanes  ·  Left Shift accent/hold\n" +
  "P2  ·  Arrow keys = lanes  ·  Right Shift accent/hold\n" +
  "[ / ]  tune BPM  ·  C  calibrate";

export const MODE_LABEL: Record<ModeId, string> = {
  trade: "TRADE",
  clash: "CLASH"
};

export const MODE_TITLE_LINE: Record<ModeId, string> = {
  trade: "  1  TRADE  — call-and-response, co-op groove",
  clash: "  2  CLASH  — competitive beat battle"
};

export const MODE_HELP: Record<ModeId, string> = {
  trade:
    "Listen — a short phrase lights up on the acting player's\n" +
    "lanes; they perform it live. Repeat — next bar, the other\n" +
    "player echoes the same phrase on their own lanes. Clean\n" +
    "handoffs raise the groove meter and unlock music layers;\n" +
    "a missed note thins it and can end the run.\n" +
    "Score = longest groove sustained, in bars.",
  clash:
    "Notes stream to both lanes — hit on the beat, perfect beats\n" +
    "good. A hit streak charges Syncopation; hold your Shift key\n" +
    "to fire it and briefly shift your rival's incoming notes\n" +
    "off-grid (their timing, never their controls).\n" +
    "Higher accuracy score when the track ends wins."
};
