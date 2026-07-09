"""Take JSON -> standard MIDI file (format 1, PPQ 480).

Track 0: tempo/meta. Track 1: left hand (channel 0). Track 2: right hand (channel 1).
Note events arrive in ms relative to record start; ticks = ms * bpm * ppq / 60000.
"""

import mido

PPQ = 480


def _ms_to_ticks(ms, bpm):
    return max(0, round(ms * bpm * PPQ / 60000.0))


def _hand_track(notes, bpm, channel, name):
    track = mido.MidiTrack()
    track.append(mido.MetaMessage("track_name", name=name, time=0))
    track.append(mido.Message("program_change", program=0, channel=channel, time=0))

    events = []  # (tick, order, message) — order keeps offs before ons at equal ticks
    for n in notes:
        on_tick = _ms_to_ticks(n["tOnMs"], bpm)
        off_tick = max(on_tick + 1, _ms_to_ticks(n["tOffMs"], bpm))
        vel = min(127, max(1, int(n["velocity"])))
        events.append((on_tick, 1, mido.Message("note_on", note=n["note"], velocity=vel, channel=channel)))
        events.append((off_tick, 0, mido.Message("note_off", note=n["note"], velocity=0, channel=channel)))

    events.sort(key=lambda e: (e[0], e[1]))
    prev = 0
    for tick, _, msg in events:
        msg.time = tick - prev
        track.append(msg)
        prev = tick
    track.append(mido.MetaMessage("end_of_track", time=0))
    return track


def write_take(take, path):
    bpm = float(take.get("bpm") or 120)
    notes = take["notes"]

    mid = mido.MidiFile(type=1, ticks_per_beat=PPQ)
    meta = mido.MidiTrack()
    meta.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(bpm), time=0))
    meta.append(mido.MetaMessage("time_signature", numerator=4, denominator=4, time=0))
    meta.append(mido.MetaMessage("end_of_track", time=0))
    mid.tracks.append(meta)

    for hand, channel, name in (("L", 0, "Left Hand"), ("R", 1, "Right Hand")):
        hand_notes = [n for n in notes if n.get("hand") == hand]
        if hand_notes:
            mid.tracks.append(_hand_track(hand_notes, bpm, channel, name))

    mid.save(str(path))
    return path
