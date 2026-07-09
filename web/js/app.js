import { codeToNote, codeToNoteTraditional, zoneLabels, traditionalLabels, OCTAVE_SHIFT_RANGE, noteName } from "./keymap.js";
import { FEELS, feelById, computeVelocity } from "./feel.js";
import { initAudio, noteOn, noteOff, allNotesOff, audioTime } from "./audio.js";
import { Keyboard } from "./keyboard.js";
import { Roll } from "./roll.js";
import { NoteStrip } from "./strip.js";
import { Recorder, quantizeNotes } from "./recorder.js";

const $ = (id) => document.getElementById(id);
const DEFAULT_NOTE_LEN_BEATS = 1; // length of a click-added note before dragging

const state = {
  octaveShifts: { L: 0, R: 0 },
  feels: { L: "lively", R: "lively" },
  layout: "split", // "split" (two hands) | "traditional" (one keyboard, A = middle C)
  mode: "idle", // idle | record | play
  take: [],     // last committed take's notes
  showLabels: true,
  overdub: true,       // layer new recordings onto the existing take
  overdubVoices: [],   // scheduled playback voices during an overdub pass
  selected: null,      // note object being edited
  drag: null,          // active roll edit gesture
  playStartTime: 0, // AudioContext time of playback beat 0
  playVoices: [],
};

const keyboard = new Keyboard($("keys"));
const roll = new Roll($("roll"));
const strip = new NoteStrip($("notestrip"));
const recorder = new Recorder();
const activeVoices = new Map(); // key -> {voiceId, note}

// ---------- layout ----------

function layout() {
  const width = document.body.clientWidth;
  const kbdH = Math.min(190, Math.max(120, window.innerHeight * 0.22));
  $("keys").style.height = `${kbdH}px`;
  keyboard.render(width, kbdH);
  roll.columnFor = (n) => keyboard.rollColumnFor(n); // narrowed top-of-key lanes (no overlap)
  strip.columnFor = (n) => keyboard.columnFor(n);    // labels stay centered over full keys
  strip.resize(width, $("notestrip").clientHeight);
  const rollH = $("roll").parentElement.clientHeight;
  roll.resize(width, rollH);
  refreshLabels();
}

function refreshLabels() {
  if (!state.showLabels) { keyboard.setLabels(null); return; }
  keyboard.setLabels(state.layout === "traditional"
    ? traditionalLabels(state.octaveShifts.R)
    : zoneLabels(state.octaveShifts));
}

// ---------- note input ----------

function beatPosOrNull() {
  return state.mode === "record" && recorder.metronome && recorder.state === "recording"
    ? recorder.beatPos()
    : null;
}

function pressNote(key, hand, note) {
  if (activeVoices.has(key)) return;
  const feel = feelById(state.feels[hand]);
  const velocity = computeVelocity(feel, beatPosOrNull());
  const voiceId = noteOn(note, velocity);
  activeVoices.set(key, { voiceId, note });
  keyboard.setPressed(note, true);
  if (state.mode === "record") recorder.noteDown(key, hand, note, velocity, feel.id);
}

function releaseNote(key) {
  const v = activeVoices.get(key);
  if (!v) return;
  activeVoices.delete(key);
  noteOff(v.voiceId);
  keyboard.setPressed(v.note, false);
  if (state.mode === "record") recorder.noteUp(key);
}

function flushAllNotes() {
  for (const key of [...activeVoices.keys()]) releaseNote(key);
}

keyboard.onNote = (note, down) => {
  // mouse play routes through the same path; hand inferred from pitch vs middle C
  const key = `mouse:${note}`;
  if (down) pressNote(key, note < 60 ? "L" : "R", note);
  else releaseNote(key);
};

// the note-name strip doubles as a click-to-audition / mouse-entry surface
strip.onNote = (note, down) => {
  const key = `strip:${note}`;
  if (down) pressNote(key, note < 60 ? "L" : "R", note);
  else releaseNote(key);
};

// ---------- keyboard events ----------

const FEEL_FKEYS = { F5: 0, F6: 1, F7: 2, F8: 3 };

function shiftOctave(hand, delta) {
  const [lo, hi] = OCTAVE_SHIFT_RANGE;
  state.octaveShifts[hand] = Math.min(hi, Math.max(lo, state.octaveShifts[hand] + delta));
  refreshLabels();
  updateStatus();
}

function toggleLayout() {
  flushAllNotes(); // the mapping changes underfoot — release anything held
  state.layout = state.layout === "split" ? "traditional" : "split";
  if (state.layout === "traditional") state.feels.L = state.feels.R; // one feel for the whole keyboard
  refreshLabels();
  syncUi();
  setStatus(state.layout === "traditional"
    ? "Traditional layout — one keyboard, A = middle C"
    : "Split layout — left & right hand zones");
}

window.addEventListener("keydown", (e) => {
  if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.target instanceof Element && e.target.matches("input, textarea, select")) return;

  if ((e.code === "Delete" || e.code === "Backspace") && state.mode === "idle" && state.selected) {
    e.preventDefault();
    deleteNote(state.selected);
    return;
  }
  if (e.code === "Space") { e.preventDefault(); toggleRecord(); return; }
  if (e.code === "Enter") { e.preventDefault(); startPlayback(); return; }
  if (e.code === "Escape") { state.selected = null; stopAll(); return; }
  if (e.code === "F10") { e.preventDefault(); recorder.metronome = !recorder.metronome; syncUi(); return; }
  if (e.code === "F9") { e.preventDefault(); toggleLayout(); return; }
  if (e.code in FEEL_FKEYS) {
    e.preventDefault();
    const id = FEELS[FEEL_FKEYS[e.code]].id;
    state.feels.L = id;
    state.feels.R = id;
    syncUi();
    return;
  }
  // Octave: split → ←→ move LH, ↑↓ move RH. Traditional → any arrow moves the single octave.
  const trad = state.layout === "traditional";
  if (e.code === "ArrowLeft") { e.preventDefault(); shiftOctave(trad ? "R" : "L", -1); return; }
  if (e.code === "ArrowRight") { e.preventDefault(); shiftOctave(trad ? "R" : "L", 1); return; }
  if (e.code === "ArrowDown") { e.preventDefault(); shiftOctave("R", -1); return; }
  if (e.code === "ArrowUp") { e.preventDefault(); shiftOctave("R", 1); return; }

  const hit = trad
    ? codeToNoteTraditional(e.code, state.octaveShifts.R)
    : codeToNote(e.code, state.octaveShifts);
  if (hit) {
    e.preventDefault();
    pressNote(e.code, hit.hand, hit.note);
  }
});

window.addEventListener("keyup", (e) => releaseNote(e.code));
window.addEventListener("blur", flushAllNotes);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) flushAllNotes();
});

// ---------- transport ----------

function scheduleTake(startTime) {
  // schedule every take note for audible playback from startTime (AudioContext time)
  const voices = [];
  for (const n of state.take) {
    const voiceId = noteOn(n.note, n.velocity, startTime + n.tOnMs / 1000);
    if (voiceId !== null) {
      noteOff(voiceId, startTime + n.tOffMs / 1000);
      voices.push(voiceId);
    }
  }
  return voices;
}

function isOverdub() {
  return state.overdub && state.take.length > 0;
}

function toggleRecord() {
  if (state.mode === "record") return stopRecord();
  if (state.mode === "play") stopAll();
  state.selected = null;
  recorder.bpm = Number($("bpm").value) || 120;
  recorder.start();
  // overdub: hear the existing take play back while you record the new pass
  state.overdubVoices = isOverdub() ? scheduleTake(recorder.startTime) : [];
  state.mode = "record";
  syncUi();
}

function stopRecord() {
  const newNotes = recorder.stop();
  for (const v of state.overdubVoices) noteOff(v); // cancel any still-scheduled playback
  state.overdubVoices = [];
  state.mode = "idle";
  flushAllNotes();

  if (isOverdub()) {
    if (newNotes.length) {
      state.take = [...state.take, ...newNotes].sort((a, b) => a.tOnMs - b.tOnMs);
      setStatus(`overdubbed ${newNotes.length} notes — take now ${state.take.length}`);
    } else {
      setStatus("overdub pass added nothing — take unchanged");
    }
  } else {
    state.take = newNotes;
    setStatus(newNotes.length ? `${newNotes.length} notes captured — Enter to play, or edit the roll` : "empty take discarded");
  }
  syncUi();
}

function startPlayback() {
  if (state.mode !== "idle" || !state.take.length) return;
  const bpm = Number($("bpm").value) || 120;
  state.mode = "play";
  state.playStartTime = audioTime() + 0.15;
  state.playVoices = scheduleTake(state.playStartTime);
  syncUi();
}

function stopAll() {
  if (state.mode === "record") return stopRecord();
  state.mode = "idle";
  allNotesOff();
  flushAllNotes();
  for (const n of state.take) keyboard.setPressed(n.note, false);
  syncUi();
}

async function saveTake() {
  if (!state.take.length) return setStatus("nothing to save");
  const bpm = Number($("bpm").value) || 120;
  let notes = state.take;
  const grid = Number($("quantize").value);
  if (grid > 0) notes = quantizeNotes(notes, bpm, grid, Number($("qstrength").value) / 100);

  const res = await fetch("/api/takes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: $("takename").value, bpm, ppq: 480, notes }),
  });
  const body = await res.json();
  setStatus(res.ok ? `saved ${body.saved}` : `save failed: ${body.error}`);
  if (res.ok) loadTakeList();
}

async function loadTakeList() {
  const takes = await (await fetch("/api/takes")).json();
  $("takelist").innerHTML = takes.slice(0, 8)
    .map((t) => `<li>${t.file}</li>`).join("");
}

// ---------- render loop ----------

function frame() {
  // schedule first so one bad frame can never kill the loop
  requestAnimationFrame(frame);
  try {
    frameBody();
  } catch (err) {
    console.error("frame error:", err);
  }
}

function frameBody() {
  recorder.tick();
  const active = new Set([...activeVoices.values()].map((v) => v.note));
  if (state.mode === "record") {
    roll.draw({
      mode: "record",
      nowMs: Math.max(0, recorder.nowMs),
      notes: recorder.notes,
      held: [...recorder.held.values()],
      bpm: recorder.bpm,
      ghost: isOverdub() ? state.take : null,
    });
    $("clock").textContent = fmtClock(recorder.nowMs, recorder.bpm);
  } else if (state.mode === "play") {
    const nowMs = (audioTime() - state.playStartTime) * 1000;
    const bpm = Number($("bpm").value) || 120;
    roll.draw({ mode: "play", nowMs, notes: state.take, held: null, bpm });
    for (const n of state.take) {
      const on = nowMs >= n.tOnMs && nowMs < n.tOffMs;
      keyboard.setPressed(n.note, on);
      if (on) active.add(n.note);
    }
    $("clock").textContent = fmtClock(nowMs, bpm);
    const end = Math.max(...state.take.map((n) => n.tOffMs));
    if (nowMs > end + 400) stopAll();
  } else {
    roll.drawIdle(state.take, Number($("bpm").value) || 120, state.selected);
  }
  strip.render(active);
}

function fmtClock(ms, bpm) {
  if (ms < 0) return "count-in";
  const beats = ms / (60000 / bpm);
  return `bar ${Math.floor(beats / 4) + 1} · beat ${Math.floor(beats % 4) + 1}`;
}

// ---------- UI ----------

function feelChips(hand) {
  return FEELS.map((f) =>
    `<button class="chip ${state.feels[hand] === f.id ? "active" : ""}" ` +
    `style="--c:${f.color}" data-hand="${hand}" data-feel="${f.id}">${f.name}</button>`
  ).join("");
}

function syncUi() {
  const trad = state.layout === "traditional";
  if (trad) state.feels.L = state.feels.R; // keep the single feel uniform
  $("chips-L").innerHTML = feelChips("L");
  $("chips-R").innerHTML = feelChips("R");
  $("rec").textContent = state.mode === "record" ? "■ Stop" : (isOverdub() ? "● Overdub" : "● Record");
  $("rec").classList.toggle("recording", state.mode === "record");
  $("play").textContent = state.mode === "play" ? "■ Stop" : "▶ Play";
  $("metro").classList.toggle("active", recorder.metronome);
  $("overdub").classList.toggle("active", state.overdub);
  $("layout").textContent = trad ? "⌨ Traditional" : "✋ Split hands";
  $("group-L").classList.toggle("hidden", trad);
  $("label-R").textContent = trad ? "Keyboard" : "Right hand";
  updateStatus();
}

function updateStatus() {
  const o = state.octaveShifts;
  if (state.layout === "traditional") {
    $("oct-R").textContent = `A = ${noteName(60 + o.R * 12)}  (←→ octave)`;
  } else {
    $("oct-L").textContent = `LH ${noteName(48 + o.L * 12)}  (←/→)`;
    $("oct-R").textContent = `RH ${noteName(72 + o.R * 12)}  (↑/↓)`;
  }
}

function setStatus(msg) {
  $("status").textContent = msg;
}

document.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (chip) {
    state.feels[chip.dataset.hand] = chip.dataset.feel;
    if (state.layout === "traditional") state.feels.L = state.feels.R = chip.dataset.feel;
    syncUi();
  }
});

$("rec").onclick = toggleRecord;
$("play").onclick = () => (state.mode === "play" ? stopAll() : startPlayback());
$("save").onclick = saveTake;
$("discard").onclick = () => { state.take = []; state.selected = null; setStatus("take discarded"); };
$("metro").onclick = () => { recorder.metronome = !recorder.metronome; syncUi(); };
$("overdub").onclick = () => { state.overdub = !state.overdub; syncUi(); };
$("layout").onclick = toggleLayout;
$("labels").onclick = () => { state.showLabels = !state.showLabels; refreshLabels(); };
$("roll").addEventListener("wheel", (e) => { e.preventDefault(); roll.zoom(e.deltaY > 0 ? -1 : 1); }, { passive: false });
window.addEventListener("resize", layout);

// ---------- roll editing (idle only): select / move / resize / add / delete ----------

let previewVoice = null;
let previewTimer = null;
function previewNote(note, velocity) {
  if (previewVoice) noteOff(previewVoice);
  if (previewTimer) clearTimeout(previewTimer);
  previewVoice = noteOn(note, velocity);
  previewTimer = setTimeout(() => {
    if (previewVoice) { noteOff(previewVoice); previewVoice = null; }
  }, 320);
}

function deleteNote(note) {
  const i = state.take.indexOf(note);
  if (i >= 0) state.take.splice(i, 1);
  if (state.selected === note) state.selected = null;
  setStatus(`deleted note — ${state.take.length} left`);
}

function currentBpm() {
  return Number($("bpm").value) || 120;
}

const rollCanvas = $("roll");

rollCanvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (state.mode !== "idle") return;
  const hit = roll.hitTest(e.offsetX, e.offsetY, state.take, currentBpm());
  if (hit) deleteNote(hit.note);
});

rollCanvas.addEventListener("pointerdown", (e) => {
  if (state.mode !== "idle" || e.button !== 0) return;
  const bpm = currentBpm();
  const hit = roll.hitTest(e.offsetX, e.offsetY, state.take, bpm);
  try { rollCanvas.setPointerCapture(e.pointerId); } catch {}

  if (hit) {
    state.selected = hit.note;
    if (hit.region === "end") {
      state.drag = { kind: "resize", note: hit.note };
    } else {
      state.drag = {
        kind: "move", note: hit.note,
        grabTime: roll.yToTime(e.offsetY, bpm),
        origOn: hit.note.tOnMs, origOff: hit.note.tOffMs,
      };
    }
    return;
  }

  // empty space -> add a note at this pitch/time and drag its length
  const pitch = roll.pitchAt(e.offsetX);
  if (pitch === null) return;
  const t = Math.max(0, roll.yToTime(e.offsetY, bpm));
  const hand = pitch < 60 ? "L" : "R";
  const feel = feelById(state.feels[hand]);
  const velocity = computeVelocity(feel, null);
  const minLen = 40;
  const note = { note: pitch, velocity, hand, feel: feel.id, tOnMs: Math.round(t), tOffMs: Math.round(t) + minLen };
  state.take.push(note);
  state.selected = note;
  state.drag = { kind: "draw", note, anchorTime: t };
  previewNote(pitch, velocity);
});

rollCanvas.addEventListener("pointermove", (e) => {
  const bpm = currentBpm();
  if (!state.drag) {
    // hover cursor feedback
    if (state.mode !== "idle") { rollCanvas.style.cursor = "default"; return; }
    const hit = roll.hitTest(e.offsetX, e.offsetY, state.take, bpm);
    rollCanvas.style.cursor = hit ? (hit.region === "end" ? "ns-resize" : "grab")
      : (roll.pitchAt(e.offsetX) !== null ? "crosshair" : "default");
    return;
  }

  const d = state.drag;
  const t = roll.yToTime(e.offsetY, bpm);
  if (d.kind === "resize") {
    d.note.tOffMs = Math.round(Math.max(d.note.tOnMs + 40, t));
  } else if (d.kind === "draw") {
    d.note.tOffMs = Math.round(Math.max(d.anchorTime + 40, t));
  } else if (d.kind === "move") {
    const len = d.origOff - d.origOn;
    const newOn = Math.max(0, d.origOn + (t - d.grabTime));
    d.note.tOnMs = Math.round(newOn);
    d.note.tOffMs = Math.round(newOn + len);
    const pitch = roll.pitchAt(e.offsetX);
    if (pitch !== null && pitch !== d.note.note) {
      d.note.note = pitch;
      d.note.hand = pitch < 60 ? "L" : "R";
      previewNote(pitch, d.note.velocity);
    }
  }
});

function endDrag(e) {
  if (!state.drag) return;
  const d = state.drag;
  if (d.kind === "draw" && d.note.tOffMs - d.note.tOnMs <= 45) {
    // a click without a drag -> give it a default length
    d.note.tOffMs = d.note.tOnMs + Math.round((60000 / currentBpm()) * DEFAULT_NOTE_LEN_BEATS);
  }
  state.drag = null;
  rollCanvas.style.cursor = "default";
}
rollCanvas.addEventListener("pointerup", endDrag);
rollCanvas.addEventListener("pointercancel", endDrag);

// ---------- boot ----------

$("start").onclick = async () => {
  $("start").disabled = true;
  $("start").textContent = "loading piano…";
  await initAudio();
  $("overlay").remove();
  layout();
  syncUi();
  loadTakeList();
  requestAnimationFrame(frame);
};
