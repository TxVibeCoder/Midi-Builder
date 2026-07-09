# KeyPlay

Play piano from your typing keyboard, watch the roll rise like a player piano,
and save the take as a standard MIDI file.

## Run

```
pip install -r requirements.txt
python -m keyplay
```

Opens `http://127.0.0.1:8737/` in your browser. Windows and Mac — the piano
samples are pre-rendered and committed (`web/samples/`), so nothing beyond
Python + pip is needed on the playing machine.

## Playing

- **Left hand**: Z-row is white keys (`z x c v b n m , . /`), A-row above it is
  the sharps (`s d g h j l ;`). Starts at C3.
- **Right hand**: Q-row is white keys (`q w e r t y u i o p [ ]`), number row is
  the sharps (`2 3 5 6 7 9 0 =`). Starts at C5.
- **Octaves**: `←`/`→` shift the left hand, `↑`/`↓` shift the right hand.
- **Feel presets** (`F5`–`F8`: Lively, Soft, Dramatic, Warm): typing keys carry no
  velocity, so the active preset generates it — base level, humanized jitter, and
  beat accents (when the click is on). Each note is stamped with the feel that was
  active when you played it; switching feels mid-take colors what comes next and
  never changes what's already on the roll. Per-hand feel via the chips in the top bar.
- **Transport**: `Space` record/stop, `Enter` play, `Esc` stop, `F10` metronome
  (with a 1-bar count-in when recording).
- **Save**: writes `output/<timestamp>_<name>.mid` (format 1 — left hand and right
  hand as separate tracks) plus a JSON sidecar of the raw take. Optional quantize
  (1/8 or 1/16, with strength) is applied at save time.

## Chords / rollover

Chords work; note that most typing keyboards ghost beyond ~6 simultaneous keys.
The two-rows-per-hand layout spreads chords across rows, which helps — chords of
up to ~4 notes per hand are generally safe.

## Regenerating the piano samples (optional, Windows authoring box)

`python tools/render_samples.py` re-renders `web/samples/` from the FluidR3_GM
soundfont via FluidSynth + ffmpeg (paths/quirks handled in the script).
