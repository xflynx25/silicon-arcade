export type ModeId = "core" | "grid";

export const MODE_LABEL: Record<ModeId, string> = {
  core: "CORE",
  grid: "GRID"
};

// short one-liners shown together on the title screen
export const MODE_DESCRIPTION: Record<ModeId, string> = {
  core: "one central Core — hold it through 6 waves",
  grid: "three separate nodes — lose one and it's over"
};

const CONTROLS =
  "P1  ·  W A S D move  ·  Left Shift ping  ·  Space strike\n" +
  "P2  ·  Arrow keys move  ·  Right Shift ping  ·  Enter strike";

const COMMON =
  "BLACKOUT — co-op survival in the dark. The black hides what's crawling in.\n\n" +
  "· PING sends out a sonar ring — every foe it sweeps lights up, then fades.\n" +
  "· STRIKE destroys foes close to you; position using what your pings reveal.\n" +
  "· Ping FAR APART from your partner and the rings RESONATE — the wider the\n" +
  "  gap, the bigger the blast. Pinging on top of each other does nothing.\n" +
  "· Stand on a hurt base to slowly REPAIR it.\n\n" +
  "Foes: drifters crawl · darters are fast · husks & brutes are tanky ·\n" +
  "broods split into darters when killed · SIRENS stop at range and drain your\n" +
  "base from afar — camping won't save it, you have to go out and kill them.\n";

// descriptive body per mode; the control block is appended separately
export const MODE_HELP: Record<ModeId, string> = {
  core:
    COMMON +
    "\nCORE — defend the single Core at the center. Let it fall and the dark wins.\n\n" +
    CONTROLS,
  grid:
    COMMON +
    "\nGRID — three nodes are scattered across the arena and foes swarm the\n" +
    "nearest one. You can't hold them all from a single spot — spread out.\n" +
    "Lose even one node and the run ends.\n\n" +
    CONTROLS
};
