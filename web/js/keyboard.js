// Realistic SVG piano, HORIZONTAL along the bottom of the window (explicitly not
// the DAW-style left keybed). Exposes per-note x-geometry so the vertical roll
// above can align its note columns exactly to the keys.

import { isBlack, noteName } from "./keymap.js";

export const KBD_LO = 36; // C2
export const KBD_HI = 96; // C7
const BLACK_W_RATIO = 0.62;
const BLACK_H_RATIO = 0.62;
// Horizontal offset of each black key from the white-key boundary it sits on,
// as a fraction of black-key width (real pianos: C#/F# lean left, D#/A# lean right).
const BLACK_LEAN = { 1: -0.12, 3: 0.12, 6: -0.15, 8: 0, 10: 0.15 };

export function buildGeometry(totalWidth, whiteHeight) {
  const whites = [];
  for (let n = KBD_LO; n <= KBD_HI; n++) if (!isBlack(n)) whites.push(n);
  const whiteW = totalWidth / whites.length;
  const blackW = whiteW * BLACK_W_RATIO;
  const blackH = whiteHeight * BLACK_H_RATIO;

  const geo = new Map(); // note -> {x, w, black}
  whites.forEach((n, i) => geo.set(n, { x: i * whiteW, w: whiteW, black: false }));
  for (let n = KBD_LO; n <= KBD_HI; n++) {
    if (!isBlack(n)) continue;
    const leftWhite = geo.get(n - 1);
    const boundary = leftWhite.x + leftWhite.w;
    const lean = BLACK_LEAN[n % 12] || 0;
    geo.set(n, { x: boundary - blackW / 2 + lean * blackW, w: blackW, black: true });
  }
  return { geo, whiteW, blackW, blackH, whiteH: whiteHeight };
}

export class Keyboard {
  constructor(svgEl) {
    this.svg = svgEl;
    this.keyEls = new Map();
    this.labelEls = new Map();
    this.onNote = null; // (note, isDown) — mouse play hook
    this._mouseNote = null;
  }

  render(width, height) {
    const g = buildGeometry(width, height);
    this.geometry = g;
    const svg = this.svg;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.innerHTML = `
      <defs>
        <linearGradient id="whiteGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#e9e6df"/><stop offset="0.75" stop-color="#fdfcf8"/>
          <stop offset="1" stop-color="#f2efe8"/>
        </linearGradient>
        <linearGradient id="whiteDown" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#cfccc3"/><stop offset="1" stop-color="#e5e2d9"/>
        </linearGradient>
        <linearGradient id="blackGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#3a3a3c"/><stop offset="0.12" stop-color="#111"/>
          <stop offset="0.85" stop-color="#1c1c1e"/><stop offset="1" stop-color="#000"/>
        </linearGradient>
        <linearGradient id="blackDown" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#222"/><stop offset="1" stop-color="#0a0a0a"/>
        </linearGradient>
        <linearGradient id="feltShade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="rgba(0,0,0,0.45)"/><stop offset="1" stop-color="rgba(0,0,0,0)"/>
        </linearGradient>
      </defs>`;

    const ns = "http://www.w3.org/2000/svg";
    const mk = (tag, attrs) => {
      const el = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      return el;
    };

    // white keys first, then felt/shadow, then black keys on top
    for (const [note, k] of g.geo) {
      if (k.black) continue;
      const el = mk("rect", {
        x: k.x + 0.5, y: 0, width: k.w - 1, height: height - 1, rx: 3,
        fill: "url(#whiteGrad)", stroke: "#b8b4aa", "stroke-width": 1,
        class: "key white", "data-note": note,
      });
      svg.appendChild(el);
      this.keyEls.set(note, el);
    }
    // red felt strip along the top + soft shade under it
    svg.appendChild(mk("rect", { x: 0, y: 0, width, height: 3.5, fill: "#a5232d" }));
    svg.appendChild(mk("rect", { x: 0, y: 3.5, width, height: 10, fill: "url(#feltShade)", "pointer-events": "none" }));

    for (const [note, k] of g.geo) {
      if (!k.black) continue;
      const grp = mk("g", { class: "key black", "data-note": note });
      grp.appendChild(mk("rect", {
        x: k.x, y: 0, width: k.w, height: g.blackH, rx: 2.5,
        fill: "url(#blackGrad)", stroke: "#000", "stroke-width": 0.5,
      }));
      // glossy face highlight
      grp.appendChild(mk("rect", {
        x: k.x + k.w * 0.18, y: g.blackH * 0.06, width: k.w * 0.64, height: g.blackH * 0.55,
        rx: 2, fill: "rgba(255,255,255,0.09)", "pointer-events": "none",
      }));
      svg.appendChild(grp);
      this.keyEls.set(note, grp);
    }

    // QWERTY hint labels (toggleable), one per key
    for (const [note, k] of g.geo) {
      const label = mk("text", {
        x: k.x + k.w / 2, y: k.black ? g.blackH - 8 : height - 10,
        "text-anchor": "middle", class: `keylabel ${k.black ? "on-black" : "on-white"}`,
        "pointer-events": "none",
      });
      svg.appendChild(label);
      this.labelEls.set(note, label);
    }

    // mouse play
    svg.onpointerdown = (e) => {
      const keyEl = e.target.closest(".key");
      if (!keyEl || !this.onNote) return;
      svg.setPointerCapture(e.pointerId);
      this._mouseNote = Number(keyEl.dataset.note);
      this.onNote(this._mouseNote, true);
    };
    const release = () => {
      if (this._mouseNote !== null && this.onNote) this.onNote(this._mouseNote, false);
      this._mouseNote = null;
    };
    svg.onpointerup = release;
    svg.onpointercancel = release;
  }

  setPressed(note, down) {
    const el = this.keyEls.get(note);
    if (el) el.classList.toggle("pressed", down);
  }

  // labels: note -> {hand, label}; pass null to clear
  setLabels(labels) {
    for (const [note, el] of this.labelEls) {
      const hit = labels && labels[note];
      el.textContent = hit ? hit.label : "";
      el.classList.toggle("lh", !!hit && hit.hand === "L");
      el.classList.toggle("rh", !!hit && hit.hand === "R");
    }
  }

  columnFor(note) {
    return this.geometry.geo.get(note) || null;
  }

  titleFor(note) {
    return noteName(note);
  }
}
