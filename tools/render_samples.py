"""Render piano one-shot samples from FluidR3_GM for the in-browser player.

Windows-only authoring tool (needs FluidSynth + ffmpeg); the resulting MP3s and
samples.json are committed so end machines (including Mac) need neither.

Pipeline per (note, velocity layer):
  mido writes a tiny .mid -> FluidSynth renders WAV (flags passed SEPARATELY:
  this build was compiled without getopt, `-ni` silently hangs; must be `-n -i`)
  -> onset-trim (find first non-silent sample) -> ffmpeg encodes MP3 160k
  -> decode the MP3 back and measure its true onset (LAME pads leading silence),
     stored as startOffsetSec so playback starts at the attack.
"""

import glob
import json
import os
import shutil
import subprocess
import sys
import wave
from pathlib import Path

import mido

ROOT = Path(__file__).resolve().parents[1]
SAMPLES_DIR = ROOT / "web" / "samples"
SCRATCH = ROOT / "tools" / "_scratch"
SOUNDFONT = Path(r"C:\Users\wba\Documents\MIDI Builder\assets\soundfonts\FluidR3_GM.sf2")

NOTE_LO, NOTE_HI, NOTE_STEP = 21, 108, 3
LAYERS = [60, 110]          # velocity layers; browser picks by threshold
LAYER_THRESHOLD = 85
HOLD_S = 2.0                # note held this long
CLIP_S = 2.8                # final clip length incl. release tail
SAMPLE_RATE = 44100
SILENCE_ABS = 300           # int16 threshold for onset detection


def _find_tool(name, fallback_globs):
    p = shutil.which(name)
    if p:
        return p
    for pattern in fallback_globs:
        hits = glob.glob(pattern)
        if hits:
            return hits[0]
    raise FileNotFoundError(f"{name} not found on PATH or fallback locations")


FLUIDSYNTH = _find_tool("fluidsynth", [r"C:\ProgramData\chocolatey\bin\fluidsynth.exe"])
FFMPEG = _find_tool(
    "ffmpeg",
    [os.path.expanduser(r"~\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg*\ffmpeg-*\bin\ffmpeg.exe")],
)


def write_note_mid(path, note, velocity):
    mid = mido.MidiFile(ticks_per_beat=480)
    track = mido.MidiTrack()
    mid.tracks.append(track)
    track.append(mido.Message("program_change", program=0, time=0))
    track.append(mido.Message("note_on", note=note, velocity=velocity, time=0))
    # 120 bpm default: 480 ticks = 1 beat = 0.5 s
    track.append(mido.Message("note_off", note=note, velocity=0, time=int(HOLD_S * 960)))
    mid.save(str(path))


def wav_onset_seconds(wav_path):
    """Seconds from file start to the first sample above the silence threshold."""
    with wave.open(str(wav_path), "rb") as w:
        assert w.getsampwidth() == 2, "expected 16-bit WAV"
        frames = w.readframes(w.getnframes())
        channels = w.getnchannels()
        rate = w.getframerate()
    samples = memoryview(frames).cast("h")
    for i in range(0, len(samples)):
        if abs(samples[i]) > SILENCE_ABS:
            return (i // channels) / rate
    return 0.0


def run(cmd):
    subprocess.run(cmd, check=True, capture_output=True)


def render_one(note, velocity):
    tag = f"v{velocity:03d}_n{note:03d}"
    mid = SCRATCH / f"{tag}.mid"
    raw = SCRATCH / f"{tag}_raw.wav"
    mp3 = SAMPLES_DIR / f"{tag}.mp3"
    check = SCRATCH / f"{tag}_check.wav"

    write_note_mid(mid, note, velocity)
    run([FLUIDSYNTH, "-n", "-i", "-F", str(raw), "-r", str(SAMPLE_RATE), str(SOUNDFONT), str(mid)])
    onset = wav_onset_seconds(raw)
    run([FFMPEG, "-y", "-ss", f"{onset:.4f}", "-i", str(raw), "-t", str(CLIP_S),
         "-codec:a", "libmp3lame", "-b:a", "160k", str(mp3)])
    # measure residual leading silence in the encoded file (LAME delay)
    run([FFMPEG, "-y", "-i", str(mp3), str(check)])
    start_offset = wav_onset_seconds(check)
    return {"note": note, "layer": velocity, "file": mp3.name,
            "startOffsetSec": round(start_offset, 4)}


def main():
    if not SOUNDFONT.exists():
        sys.exit(f"soundfont missing: {SOUNDFONT}")
    SCRATCH.mkdir(parents=True, exist_ok=True)
    SAMPLES_DIR.mkdir(parents=True, exist_ok=True)

    entries = []
    notes = list(range(NOTE_LO, NOTE_HI + 1, NOTE_STEP))
    for i, note in enumerate(notes):
        for vel in LAYERS:
            entries.append(render_one(note, vel))
        print(f"[{i + 1}/{len(notes)}] note {note} done", flush=True)

    manifest = {
        "noteLo": NOTE_LO, "noteHi": NOTE_HI, "noteStep": NOTE_STEP,
        "layers": LAYERS, "layerThreshold": LAYER_THRESHOLD,
        "samples": entries,
    }
    (SAMPLES_DIR / "samples.json").write_text(json.dumps(manifest, indent=1))
    shutil.rmtree(SCRATCH)
    print(f"wrote {len(entries)} samples + samples.json")


if __name__ == "__main__":
    main()
