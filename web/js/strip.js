// Note-name reference row directly above the keys: a piano "ruler" showing the
// actual musical note of each column (white keys get their letter, every C gets
// its octave number). Columns share the keyboard/roll x-geometry so a name lines
// up under its roll lane and over its key. Also a click target for auditioning a
// pitch and for mouse note-entry.

import { KBD_LO, KBD_HI } from "./keyboard.js";
import { isBlack, noteName } from "./keymap.js";

export class NoteStrip {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.columnFor = null; // injected from keyboard geometry
    this.onNote = null;    // (note, isDown) — click-to-audition / mouse entry
    this._down = null;

    canvas.onpointerdown = (e) => {
      const note = this._pitchAt(e.offsetX);
      if (note === null || !this.onNote) return;
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      this._down = note;
      this.onNote(note, true);
    };
    const up = () => {
      if (this._down !== null && this.onNote) this.onNote(this._down, false);
      this._down = null;
    };
    canvas.onpointerup = up;
    canvas.onpointercancel = up;
  }

  resize(width, height) {
    const dpr = window.devicePixelRatio || 1;
    this.w = width;
    this.h = height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _pitchAt(x) {
    if (!this.columnFor) return null;
    for (const black of [true, false]) {
      for (let n = KBD_LO; n <= KBD_HI; n++) {
        const col = this.columnFor(n);
        if (col && col.black === black && x >= col.x && x <= col.x + col.w) return n;
      }
    }
    return null;
  }

  // active: Set of currently-sounding notes (lit up).
  render(active) {
    const { ctx, w, h } = this;
    if (!this.columnFor) return;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0c0c0d";
    ctx.fillRect(0, 0, w, h);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let n = KBD_LO; n <= KBD_HI; n++) {
      const col = this.columnFor(n);
      if (!col) continue;
      const lit = active && active.has(n);
      const isC = n % 12 === 0;
      const cx = col.x + col.w / 2;

      if (isBlack(n)) {
        ctx.fillStyle = lit ? "#e8a33d" : "rgba(0,0,0,0.55)";
        ctx.fillRect(col.x, 0, col.w, h);
        continue;
      }
      // white column
      ctx.fillStyle = lit ? "rgba(232,163,61,0.9)" : isC ? "rgba(255,255,255,0.07)" : "transparent";
      if (ctx.fillStyle !== "transparent") ctx.fillRect(col.x + 0.5, 0, col.w - 1, h);
      ctx.fillStyle = lit ? "#17181c" : isC ? "#e8d9ad" : "#8a877f";
      ctx.font = isC ? "bold 10px 'Segoe UI', sans-serif" : "10px 'Segoe UI', sans-serif";
      ctx.fillText(isC ? noteName(n) : noteName(n).replace(/-?\d+$/, ""), cx, h / 2 + 0.5);
    }

    // separator hairline at the bottom (against the keys)
    ctx.fillStyle = "#000";
    ctx.fillRect(0, h - 1, w, 1);
  }
}
