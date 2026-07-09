// Feel presets: since typing keys carry no velocity, the active preset GENERATES it
// at keydown. Notes are stamped with the computed velocity + feel id at record time;
// switching presets never touches already-recorded notes.

export const FEELS = [
  {
    id: "lively", name: "Lively", color: "#e8a33d",
    baseVelocity: 96, velocityJitter: 12, downbeatAccent: 14, offbeatDip: 6, gateScale: 1.0,
  },
  {
    id: "soft", name: "Soft", color: "#7fb4d9",
    baseVelocity: 52, velocityJitter: 6, downbeatAccent: 5, offbeatDip: 3, gateScale: 1.0,
  },
  {
    id: "dramatic", name: "Dramatic", color: "#c95d63",
    baseVelocity: 85, velocityJitter: 20, downbeatAccent: 22, offbeatDip: 10, gateScale: 0.95,
  },
  {
    id: "warm", name: "Warm", color: "#9dbf7e",
    baseVelocity: 72, velocityJitter: 8, downbeatAccent: 8, offbeatDip: 4, gateScale: 1.05,
  },
];

export const feelById = (id) => FEELS.find((f) => f.id === id) || FEELS[0];

const clamp = (v) => Math.min(127, Math.max(1, Math.round(v)));

// beatPos: position in the bar in beats (float), or null in free time (no grid ->
// accents are skipped, only base + jitter apply).
export function computeVelocity(feel, beatPos) {
  let v = feel.baseVelocity + feel.velocityJitter * (Math.random() * 2 - 1);
  if (beatPos !== null && beatPos !== undefined) {
    const inBeat = beatPos - Math.floor(beatPos);
    const nearDownbeat = beatPos % 4 < 0.12 || beatPos % 4 > 3.88;
    const nearOffbeat = Math.abs(inBeat - 0.5) < 0.12;
    if (nearDownbeat) v += feel.downbeatAccent;
    else if (nearOffbeat) v -= feel.offbeatDip;
  }
  return clamp(v);
}
