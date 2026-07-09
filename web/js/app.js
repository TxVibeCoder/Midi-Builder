import { codeToNote, zoneLabels, OCTAVE_SHIFT_RANGE, noteName } from "./keymap.js";
import { FEELS, feelById, computeVelocity } from "./feel.js";
import { initAudio, noteOn, noteOff, allNotesOff, audioTime } from "./audio.js";
import { Keyboard } from "./keyboard.js";
import { Roll } from "./roll.js";
import { Recorder, quantizeNotes } from "./recorder.js";

const $ = (id) => document.getElementById(id);

const state = {
  octaveShifts: { L: 0, R: 0 },
  feels: { L: "lively", R: "lively" },
  mode: "idle", // idle | record | play
  take: [],     // last committed take's notes
  showLabels: true,
  playStartTime: 0, // AudioContext time of playback beat 0
  playVoices: [],
};

const keyboard = new Keyboard($("keys"));
const roll = new Roll($("roll"));
const recorder = new Recorder();
const activeVoices = new Map(); // key -> {voiceId, note}

// ---------- layout ----------

function layout() {
  const width = document.body.clientWidth;
  const kbdH = Math.min(190, Math.max(120, window.innerHeight * 0.22));
  $("keys").style.height = `${kbdH}px`;
  keyboard.render(width, kbdH);
  roll.columnFor = (n) => keyboard.columnFor(n);
  const rollH = $("roll").parentElement.clientHeight;
  roll.resize(width, rollH);
  refreshLabels();
}

function refreshLabels() {
  keyboard.setLabels(state.showLabels ? zoneLabels(state.octaveShifts) : null);
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

// ---------- keyboard events ----------

const FEEL_FKEYS = { F5: 0, F6: 1, F7: 2, F8: 3 };

function shiftOctave(hand, delta) {
  const [lo, hi] = OCTAVE_SHIFT_RANGE;
  state.octaveShifts[hand] = Math.min(hi, Math.max(lo, state.octaveShifts[hand] + delta));
  refreshLabels();
  updateStatus();
}

window.addEventListener("keydown", (e) => {
  if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.target instanceof Element && e.target.matches("input, textarea, select")) return;

  if (e.code === "Space") { e.preventDefault(); toggleRecord(); return; }
  if (e.code === "Enter") { e.preventDefault(); startPlayback(); return; }
  if (e.code === "Escape") { stopAll(); return; }
  if (e.code === "F10") { e.preventDefault(); recorder.metronome = !recorder.metronome; syncUi(); return; }
  if (e.code in FEEL_FKEYS) {
    e.preventDefault();
    const id = FEELS[FEEL_FKEYS[e.code]].id;
    state.feels.L = id;
    state.feels.R = id;
    syncUi();
    return;
  }
  if (e.code === "ArrowLeft") { e.preventDefault(); shiftOctave("L", -1); return; }
  if (e.code === "ArrowRight") { e.preventDefault(); shiftOctave("L", 1); return; }
  if (e.code === "ArrowDown") { e.preventDefault(); shiftOctave("R", -1); return; }
  if (e.code === "ArrowUp") { e.preventDefault(); shiftOctave("R", 1); return; }

  const hit = codeToNote(e.code, state.octaveShifts);
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

function toggleRecord() {
  if (state.mode === "record") return stopRecord();
  if (state.mode === "play") stopAll();
  recorder.bpm = Number($("bpm").value) || 120;
  recorder.start();
  state.mode = "record";
  syncUi();
}

function stopRecord() {
  state.take = recorder.stop();
  state.mode = "idle";
  flushAllNotes();
  syncUi();
  setStatus(state.take.length ? `${state.take.length} notes captured — Save or play it back (Enter)` : "empty take discarded");
}

function startPlayback() {
  if (state.mode !== "idle" || !state.take.length) return;
  const bpm = Number($("bpm").value) || 120;
  state.mode = "play";
  state.playStartTime = audioTime() + 0.15;
  state.playVoices = [];
  for (const n of state.take) {
    const at = state.playStartTime + n.tOnMs / 1000;
    const off = state.playStartTime + n.tOffMs / 1000;
    const voiceId = noteOn(n.note, n.velocity, at);
    if (voiceId !== null) {
      noteOff(voiceId, off);
      state.playVoices.push(n);
    }
  }
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
  if (state.mode === "record") {
    roll.draw({
      mode: "record",
      nowMs: Math.max(0, recorder.nowMs),
      notes: recorder.notes,
      held: [...recorder.held.values()],
      bpm: recorder.bpm,
    });
    $("clock").textContent = fmtClock(recorder.nowMs, recorder.bpm);
  } else if (state.mode === "play") {
    const nowMs = (audioTime() - state.playStartTime) * 1000;
    const bpm = Number($("bpm").value) || 120;
    roll.draw({ mode: "play", nowMs, notes: state.take, held: null, bpm });
    for (const n of state.take) {
      keyboard.setPressed(n.note, nowMs >= n.tOnMs && nowMs < n.tOffMs);
    }
    $("clock").textContent = fmtClock(nowMs, bpm);
    const end = Math.max(...state.take.map((n) => n.tOffMs));
    if (nowMs > end + 400) stopAll();
  } else {
    roll.drawIdle(state.take, Number($("bpm").value) || 120);
  }
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
  $("chips-L").innerHTML = feelChips("L");
  $("chips-R").innerHTML = feelChips("R");
  $("rec").textContent = state.mode === "record" ? "■ Stop" : "● Record";
  $("rec").classList.toggle("recording", state.mode === "record");
  $("play").textContent = state.mode === "play" ? "■ Stop" : "▶ Play";
  $("metro").classList.toggle("active", recorder.metronome);
  updateStatus();
}

function updateStatus() {
  const o = state.octaveShifts;
  $("oct-L").textContent = `LH ${noteName(48 + o.L * 12)}  (←/→)`;
  $("oct-R").textContent = `RH ${noteName(72 + o.R * 12)}  (↑/↓)`;
}

function setStatus(msg) {
  $("status").textContent = msg;
}

document.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (chip) {
    state.feels[chip.dataset.hand] = chip.dataset.feel;
    syncUi();
  }
});

$("rec").onclick = toggleRecord;
$("play").onclick = () => (state.mode === "play" ? stopAll() : startPlayback());
$("save").onclick = saveTake;
$("discard").onclick = () => { state.take = []; setStatus("take discarded"); };
$("metro").onclick = () => { recorder.metronome = !recorder.metronome; syncUi(); };
$("labels").onclick = () => { state.showLabels = !state.showLabels; refreshLabels(); };
$("roll").addEventListener("wheel", (e) => { e.preventDefault(); roll.zoom(e.deltaY > 0 ? -1 : 1); }, { passive: false });
window.addEventListener("resize", layout);

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
