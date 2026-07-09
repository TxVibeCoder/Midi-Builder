// QWERTY -> note mapping. Two zones (left/right hand), chromatic runs where the
// "home" row is white keys and the row above is sharps (SynthStack layout, doubled).
// Uses KeyboardEvent.code so Shift/AltGr and non-letter glyphs don't break the map.

// Right hand: Q-row whites, number-row sharps. Index = semitones above the hand's base C.
const RH_CODES = [
  "KeyQ", "Digit2", "KeyW", "Digit3", "KeyE", "KeyR", "Digit5", "KeyT",
  "Digit6", "KeyY", "Digit7", "KeyU",                       // C..B
  "KeyI", "Digit9", "KeyO", "Digit0", "KeyP", "BracketLeft", "Equal", "BracketRight", // C..G next octave
];

// Left hand: Z-row whites, A-row sharps.
const LH_CODES = [
  "KeyZ", "KeyS", "KeyX", "KeyD", "KeyC", "KeyV", "KeyG", "KeyB",
  "KeyH", "KeyN", "KeyJ", "KeyM",                            // C..B
  "Comma", "KeyL", "Period", "Semicolon", "Slash",           // C..E next octave
];

export const HANDS = {
  L: { codes: LH_CODES, baseNote: 48, label: "Left hand" },   // C3
  R: { codes: RH_CODES, baseNote: 72, label: "Right hand" },  // C5
};

export const NOTE_MIN = 21;   // sampled range (A0..C8)
export const NOTE_MAX = 108;
export const OCTAVE_SHIFT_RANGE = [-2, 2];

const LOOKUP = new Map();
for (const [hand, def] of Object.entries(HANDS)) {
  def.codes.forEach((code, semis) => LOOKUP.set(code, { hand, semis }));
}

// Octave shift is applied HERE and only here (no double-shift — SynthStack rule).
export function codeToNote(code, octaveShifts) {
  const hit = LOOKUP.get(code);
  if (!hit) return null;
  const def = HANDS[hit.hand];
  const note = def.baseNote + 12 * octaveShifts[hit.hand] + hit.semis;
  if (note < NOTE_MIN || note > NOTE_MAX) return null;
  return { hand: hit.hand, note };
}

export function isBlack(note) {
  return [1, 3, 6, 8, 10].includes(note % 12);
}

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export function noteName(note) {
  return NOTE_NAMES[note % 12] + (Math.floor(note / 12) - 1);
}

// Key-cap label for on-screen hints (code -> printable char).
export function codeLabel(code) {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return { Comma: ",", Period: ".", Semicolon: ";", Slash: "/", BracketLeft: "[", BracketRight: "]", Equal: "=" }[code] || "";
}

// hand -> map of currently reachable note -> code label (for keyboard overlay)
export function zoneLabels(octaveShifts) {
  const out = {};
  for (const [hand, def] of Object.entries(HANDS)) {
    def.codes.forEach((code, semis) => {
      const note = def.baseNote + 12 * octaveShifts[hand] + semis;
      out[note] = { hand, label: codeLabel(code) };
    });
  }
  return out;
}
