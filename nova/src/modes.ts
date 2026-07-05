export type ModeId = "duel" | "flares" | "rings";

export const CONTROLS =
  "P1  ·  W A S D thrust  ·  hold Left Shift charge Flare  ·  Space Shield\n" +
  "P2  ·  Arrows thrust  ·  hold Right Shift charge Flare  ·  Enter Shield\n" +
  "[ / ]  ·  tune gravity";

export const MODE_LABEL: Record<ModeId, string> = {
  duel: "DUEL",
  flares: "FLARES",
  rings: "RINGS"
};

export const MODE_TITLE_LINE: Record<ModeId, string> = {
  duel: "  1  DUEL    — intercept, flare strike, shatter",
  flares: "  2  FLARES  — the star closes in; parry or die",
  rings: "  3  RINGS   — chain rings, link gold, beat the clock"
};

export const MODE_HELP: Record<ModeId, string> = {
  duel:
    "Fight — dive the star for speed, then Flare-strike\n" +
    "or ram your rival (280+ speed, clearly faster).\n" +
    "Shield parries Flares and rams; a perfect parry\n" +
    "staggers your rival. Boundaries still kill.",
  flares:
    "Survive — the corona creeps inward each wave.\n" +
    "Bolt patterns rotate: burst, spiral, crossfire.\n" +
    "Parry aimed bolts with Shield. Three shared lives.",
  rings:
    "Collect — chain rings within 3s for combo bonus.\n" +
    "Linked gold needs both comets within 4s (+6).\n" +
    "Risk rings hug the corona (5 pts). Shield pulls\n" +
    "nearby rings toward you. Soft walls only."
};
