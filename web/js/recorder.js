// Take capture state machine: idle -> armed (count-in) -> recording -> commit.
// All timestamps are ms relative to record start (beat 0), measured on the
// AudioContext clock so notes and metronome share one timebase.

import { audioTime, scheduleClick } from "./audio.js";
import { feelById } from "./feel.js";

export class Recorder {
  constructor() {
    this.state = "idle";
    this.notes = [];
    this.held = new Map(); // key (code or "mouse") -> pending note
    this.bpm = 120;
    this.countInBeats = 4;
    this.metronome = true;
    this._startTime = 0; // AudioContext time of beat 0
    this._clickTimer = null;
    this._nextClickBeat = 0;
  }

  get nowMs() {
    return (audioTime() - this._startTime) * 1000;
  }

  // AudioContext time of recording beat 0 — used to schedule overdub playback.
  get startTime() {
    return this._startTime;
  }

  beatPos() {
    return this.nowMs / (60000 / this.bpm);
  }

  start() {
    this.notes = [];
    this.held.clear();
    const beatS = 60 / this.bpm;
    const countIn = this.metronome ? this.countInBeats : 0;
    this._startTime = audioTime() + 0.05 + countIn * beatS;
    this.state = countIn ? "armed" : "recording";

    if (this.metronome) {
      for (let b = 0; b < countIn; b++) {
        scheduleClick(this._startTime - (countIn - b) * beatS, b === 0);
      }
      this._nextClickBeat = 0;
      this._clickTimer = setInterval(() => this._scheduleClicks(), 25);
    }
  }

  _scheduleClicks() {
    const beatS = 60 / this.bpm;
    const horizon = audioTime() + 0.1;
    while (this._startTime + this._nextClickBeat * beatS < horizon) {
      scheduleClick(this._startTime + this._nextClickBeat * beatS, this._nextClickBeat % 4 === 0);
      this._nextClickBeat++;
    }
    if (this.state === "armed" && audioTime() >= this._startTime) this.state = "recording";
  }

  tick() {
    // called from the rAF loop; promotes armed->recording when there is no metronome timer
    if (this.state === "armed" && audioTime() >= this._startTime) this.state = "recording";
  }

  noteDown(key, hand, note, velocity, feelId) {
    if (this.state !== "recording" && this.state !== "armed") return;
    this.held.set(key, {
      note, velocity, hand, feel: feelId,
      tOnMs: Math.max(0, this.nowMs),
    });
  }

  noteUp(key) {
    const n = this.held.get(key);
    if (!n) return;
    this.held.delete(key);
    if (this.state !== "recording") return;
    n.tOffMs = Math.max(n.tOnMs + 20, this.nowMs);
    this.notes.push(n);
  }

  stop() {
    if (this._clickTimer) clearInterval(this._clickTimer);
    this._clickTimer = null;
    // close dangling notes at the stop point
    for (const key of [...this.held.keys()]) this.noteUp(key);
    this.state = "idle";
    this.notes.sort((a, b) => a.tOnMs - b.tOnMs);
    // articulation: apply the note's feel gateScale at commit time
    for (const n of this.notes) {
      const gate = feelById(n.feel).gateScale;
      n.tOffMs = n.tOnMs + Math.max(20, (n.tOffMs - n.tOnMs) * gate);
      n.tOnMs = Math.round(n.tOnMs);
      n.tOffMs = Math.round(n.tOffMs);
    }
    return this.notes;
  }

  get isRolling() {
    return this.state === "recording" || this.state === "armed";
  }
}

// Quantize note starts to a grid, preserving each note's duration.
// FORGE MidiEditHelpers math: round-to-nearest grid point, moved by `strength` (0..1).
export function quantizeNotes(notes, bpm, gridFraction, strength) {
  const gridMs = (60000 / bpm) * 4 * gridFraction; // fraction of a whole note
  return notes.map((n) => {
    const target = Math.round(n.tOnMs / gridMs) * gridMs;
    const shift = (target - n.tOnMs) * strength;
    return { ...n, tOnMs: Math.round(n.tOnMs + shift), tOffMs: Math.round(n.tOffMs + shift) };
  });
}
