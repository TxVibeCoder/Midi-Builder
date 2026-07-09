// Vertical piano roll with player-piano MOTION (modern look): the keyboard sits
// below, note columns share its exact x-geometry, and the now-line is fixed at the
// bottom edge of this canvas (the top of the keys).
//   Recording: content scrolls upward — a held note is rooted at the now-line and
//   grows; on release it drifts up with the roll.
//   Playback: content scrolls downward — a note sounds exactly when its bottom
//   edge reaches the now-line.

import { feelById } from "./feel.js";

export class Roll {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.pxPerBeat = 48;
    this.columnFor = null; // note -> {x, w, black}; injected from keyboard geometry
  }

  resize(width, height) {
    const dpr = window.devicePixelRatio || 1;
    this.w = width;
    this.h = height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  zoom(delta) {
    this.pxPerBeat = Math.min(160, Math.max(16, this.pxPerBeat * (delta > 0 ? 0.85 : 1.18)));
  }

  // mode: "record" (past scrolls up from the now-line) | "play" (future falls down)
  // nowMs: current transport position; notes: committed notes; held: in-flight notes
  draw({ mode, nowMs, notes, held, bpm }) {
    const { ctx, w, h } = this;
    const msPerBeat = 60000 / bpm;
    const pxPerMs = this.pxPerBeat / msPerBeat;

    ctx.clearRect(0, 0, w, h);

    // key-column shading (black-key lanes darker) so the roll reads as an extension of the keys
    if (this.columnFor) {
      for (let n = 21; n <= 108; n++) {
        const col = this.columnFor(n);
        if (col && col.black) {
          ctx.fillStyle = "rgba(0,0,0,0.16)";
          ctx.fillRect(col.x, 0, col.w, h);
        }
      }
    }

    // horizontal beat grid, scrolling with the roll
    const yForTime = (t) =>
      mode === "play" ? h - (t - nowMs) * pxPerMs : h - (nowMs - t) * pxPerMs;
    const msVisible = h / pxPerMs;
    const tTop = mode === "play" ? nowMs + msVisible : nowMs - msVisible;
    const tBottom = nowMs;
    const first = Math.floor(Math.min(tTop, tBottom) / msPerBeat);
    const last = Math.ceil(Math.max(tTop, tBottom) / msPerBeat);
    for (let b = Math.max(0, first); b <= last; b++) {
      const y = yForTime(b * msPerBeat);
      if (y < -2 || y > h + 2) continue;
      const isBar = b % 4 === 0;
      ctx.strokeStyle = isBar ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
      ctx.stroke();
    }

    const drawNote = (n, tOff) => {
      const col = this.columnFor && this.columnFor(n.note);
      if (!col) return;
      let y1 = yForTime(n.tOnMs);
      let y2 = yForTime(tOff);
      let top = Math.min(y1, y2);
      let bottom = Math.max(y1, y2);
      if (bottom < 0 || top > h) return;
      top = Math.max(-4, top);
      bottom = Math.min(h + 4, bottom);
      const feel = feelById(n.feel);
      const x = col.x + 1;
      const width = col.w - 2;
      const height = Math.max(4, bottom - top);
      ctx.fillStyle = feel.color;
      ctx.strokeStyle = n.hand === "L" ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.55)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.roundRect(x, top, width, height, 3);
      ctx.fill();
      ctx.stroke();
    };

    for (const n of notes) drawNote(n, n.tOffMs);
    if (held) for (const n of held) drawNote(n, nowMs); // growing from the now-line

    // fixed now-line at the bottom edge
    ctx.fillStyle = "rgba(255, 235, 180, 0.9)";
    ctx.fillRect(0, h - 2, w, 2);
  }

  drawIdle(notes, bpm) {
    // idle: show the finished take resting above the keys (as if paused at 0 in play mode)
    this.draw({ mode: "play", nowMs: 0, notes, held: null, bpm });
  }
}
