export type ModeId = "duel" | "rally" | "goals";

const CONTROLS =
  "P1  ·  W/S slide  ·  A/D tilt  ·  Left Shift smash  ·  Space spin\n" +
  "P2  ·  ↑/↓ slide  ·  ←/→ tilt  ·  Right Shift smash  ·  Enter spin";

const CONTROLS_FREE =
  "Free move ON — arrows/WASD move in every direction; rotate is its own key.\n" +
  "P1  ·  WASD move  ·  Q/E rotate  ·  Left Shift smash  ·  Space spin\n" +
  "P2  ·  Arrows move  ·  , / . rotate  ·  Right Shift smash  ·  Enter spin";

export const controlsHelp = (freeMove: boolean): string =>
  freeMove ? CONTROLS_FREE : CONTROLS;

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

// descriptive body per mode; the control block is appended separately so it can
// reflect the current free-move state
export const MODE_HELP: Record<ModeId, string> = {
  duel:
    "Competitive duel — deflect the neon ball past\n" +
    "your rival's side. First to N wins.",
  rally:
    "Co-op rally — work together to keep the ball\n" +
    "alive as long as possible. A miss ends the rally.",
  goals:
    "Goals pong — drive the ball into your rival's\n" +
    "glowing goal zone; everywhere else the wall holds.\n" +
    "Tune goal size / drift / disappear to taste. First to N wins."
};

export const WIN_SCORE_OPTIONS = [3, 5, 7, 11] as const;

// ---- tunable goal + movement settings (index into these step arrays) ----

// goal height as a fraction of the playable arena height
export const GOAL_SIZE_STEPS = [0.2, 0.32, 0.45, 0.6, 0.78];
export const GOAL_SIZE_LABELS = ["Tiny", "Small", "Medium", "Large", "Huge"];

// vertical drift speed of the goal, px/s (0 = static)
export const GOAL_DRIFT_STEPS = [0, 45, 90, 150];
export const GOAL_DRIFT_LABELS = ["Off", "Slow", "Medium", "Fast"];

// full disappear/reappear cycle in seconds (0 = always visible). On each cycle
// the goal vanishes, then reappears at a fresh random position.
export const DISAPPEAR_STEPS = [0, 3.2, 2.2, 1.4];
export const DISAPPEAR_LABELS = ["Off", "Slow", "Medium", "Fast"];
export const DISAPPEAR_VISIBLE_FRAC = 0.7;

// how far a paddle may slide inward from its wall, as a fraction of the
// wall-to-centre distance (only used while free move is on)
export const MOVE_RANGE_STEPS = [0.15, 0.3, 0.45, 0.6, 0.8];
export const MOVE_RANGE_LABELS = ["15%", "30%", "45%", "60%", "80%"];

export type GoalSettings = {
  sizeIdx: number;
  driftIdx: number;
  disappearIdx: number;
  moveRangeIdx: number;
  freeMove: boolean;
};

export const DEFAULT_GOAL_SETTINGS: GoalSettings = {
  sizeIdx: 2,
  driftIdx: 0,
  disappearIdx: 0,
  moveRangeIdx: 1,
  freeMove: false
};

export type SettingKind = "size" | "drift" | "disappear" | "range";
