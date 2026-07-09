// Web Audio sample player + metronome. Samples are pre-rendered piano one-shots
// (every 3rd semitone, two velocity layers); neighbors are pitch-shifted via
// playbackRate. All scheduling uses AudioContext.currentTime.

let ctx = null;
let master = null;
let manifest = null;
const buffers = new Map(); // "layer:note" -> {buffer, startOffsetSec}
const voices = new Map();  // voiceId -> {src, gain}
let voiceSeq = 0;

export function audioTime() {
  return ctx ? ctx.currentTime : 0;
}

export async function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  await ctx.resume();

  manifest = await (await fetch("samples/samples.json")).json();
  await Promise.all(
    manifest.samples.map(async (s) => {
      const data = await (await fetch(`samples/${s.file}`)).arrayBuffer();
      const buffer = await ctx.decodeAudioData(data);
      buffers.set(`${s.layer}:${s.note}`, { buffer, startOffsetSec: s.startOffsetSec });
    })
  );
}

function nearestSampled(note) {
  const { noteLo, noteHi, noteStep } = manifest;
  const clamped = Math.min(noteHi, Math.max(noteLo, note));
  return noteLo + Math.round((clamped - noteLo) / noteStep) * noteStep;
}

function velocityGain(velocity) {
  return Math.pow(velocity / 127, 1.6);
}

// Starts a voice; returns a voiceId for noteOff. `when` in AudioContext time
// (0/undefined = now). Used both for live play and scheduled playback.
export function noteOn(note, velocity, when = 0) {
  if (!ctx || !manifest) return null;
  const layer = velocity >= manifest.layerThreshold ? manifest.layers[1] : manifest.layers[0];
  const root = nearestSampled(note);
  const sample = buffers.get(`${layer}:${root}`);
  if (!sample) return null;

  const src = ctx.createBufferSource();
  src.buffer = sample.buffer;
  src.playbackRate.value = Math.pow(2, (note - root) / 12);
  const gain = ctx.createGain();
  gain.gain.value = velocityGain(velocity);
  src.connect(gain);
  gain.connect(master);
  src.start(when || ctx.currentTime, sample.startOffsetSec);

  const id = ++voiceSeq;
  voices.set(id, { src, gain });
  src.onended = () => voices.delete(id);
  return id;
}

// 90 ms exponential-ish release so keyup never clicks.
export function noteOff(voiceId, when = 0) {
  const v = voices.get(voiceId);
  if (!v) return;
  const t = Math.max(ctx.currentTime, when || ctx.currentTime);
  v.gain.gain.setValueAtTime(v.gain.gain.value, t);
  v.gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  v.src.stop(t + 0.12);
  voices.delete(voiceId);
}

export function allNotesOff() {
  for (const id of [...voices.keys()]) noteOff(id);
}

// Short synthesized click; accented on the downbeat.
export function scheduleClick(when, accented) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = accented ? 1568 : 1046;
  gain.gain.setValueAtTime(accented ? 0.5 : 0.3, when);
  gain.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
  osc.connect(gain);
  gain.connect(master);
  osc.start(when);
  osc.stop(when + 0.06);
}
