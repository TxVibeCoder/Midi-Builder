"""Flask server: serves the static UI and saves takes as .mid + .json sidecar.

Deliberately out of the real-time path — the browser does all input/audio/drawing;
this only persists finished takes.
"""

import json
import re
import time
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

from keyplay.midi_write import write_take

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
OUTPUT = ROOT / "output"
PORT = 8737

app = Flask(__name__, static_folder=None)


@app.get("/")
def index():
    return send_from_directory(WEB, "index.html")


@app.get("/<path:path>")
def static_files(path):
    return send_from_directory(WEB, path)


@app.post("/api/takes")
def save_take():
    take = request.get_json(force=True)
    notes = take.get("notes") or []
    if not notes:
        return jsonify({"error": "take has no notes"}), 400

    OUTPUT.mkdir(exist_ok=True)
    name = re.sub(r"[^\w\- ]", "", take.get("name") or "take").strip() or "take"
    stamp = time.strftime("%Y%m%d_%H%M%S")
    base = f"{stamp}_{name.replace(' ', '_')}"

    mid_path = OUTPUT / f"{base}.mid"
    write_take(take, mid_path)
    (OUTPUT / f"{base}.json").write_text(json.dumps(take, indent=1))
    return jsonify({"saved": mid_path.name, "path": str(mid_path)})


@app.get("/api/takes")
def list_takes():
    OUTPUT.mkdir(exist_ok=True)
    takes = sorted(OUTPUT.glob("*.mid"), reverse=True)
    return jsonify([{"file": p.name, "sizeBytes": p.stat().st_size} for p in takes])
