export type ModeId = "duel" | "rally" | "goals";

const CONTROLS =
  "P1  ·  W/S slide  ·  A/D tilt  ·  Left Shift smash  ·  Space spin\n" +
  "P2  ·  ↑/↓ slide  ·  ←/→ tilt  ·  Right Shift smash  ·  Enter spin";

export const MODE_LABEL: Record<ModeId, string> = {
  duel: "DUEL",
  rally: "RALLY",
  goals: "GOALS"
};

// short one-liners shown together on the title/config screen
export const MODE_DESCRIPTION: Record<ModeId, string> = {
  duel: "competitive, first to N",
  rally: "co-op, one shared ball, chase your best rally",
  goals: "competitive, score only through the goal sections"
};

export const MODE_HELP: Record<ModeId, string> = {
  duel:
    "Competitive duel — deflect the neon ball past\n" +
    "your rival's side. First to N wins.\n\n" +
    CONTROLS,
  rally:
    "Co-op rally — work together to keep the ball\n" +
    "alive as long as possible. A miss ends the rally.\n\n" +
    CONTROLS,
  goals:
    "Goals pong — drive the ball into your rival's\n" +
    "glowing goal zones; everywhere else the wall holds.\n" +
    "First to N wins.\n\n" +
    CONTROLS
};

export const WIN_SCORE_OPTIONS = [3, 5, 7, 11] as const;

export type GoalPreset = "static" | "moving" | "moveOnHit" | "double" | "disappearing";

export const GOAL_PRESET_ORDER: GoalPreset[] = [
  "static",
  "moving",
  "moveOnHit",
  "double",
  "disappearing"
];

export const GOAL_PRESET_LABEL: Record<GoalPreset, string> = {
  static: "Static section",
  moving: "Moving",
  moveOnHit: "Move-on-hit",
  double: "Double",
  disappearing: "Disappearing"
};
