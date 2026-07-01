export type ModeId = "duel" | "rally" | "goals";

const CONTROLS =
  "P1  ·  W/S slide  ·  A/D tilt  ·  Left Shift smash  ·  Space spin\n" +
  "P2  ·  ↑/↓ slide  ·  ←/→ tilt  ·  Right Shift smash  ·  Enter spin";

export const MODE_LABEL: Record<ModeId, string> = {
  duel: "DUEL",
  rally: "RALLY",
  goals: "GOALS"
};

export const MODE_HELP: Record<ModeId, string> = {
  duel:
    "Competitive duel — deflect the neon ball past\n" +
    "your rival's side. First to 5 wins.\n\n" +
    CONTROLS,
  rally:
    "Co-op rally — work together to keep the ball\n" +
    "alive as long as possible. A miss ends the rally.\n\n" +
    CONTROLS,
  goals:
    "Goals pong — drive the ball into your rival's\n" +
    "glowing goal zones; everywhere else the wall holds.\n" +
    "First to 5 wins.\n\n" +
    CONTROLS
};
