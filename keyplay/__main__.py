"""Entry point: `python -m keyplay` starts the server and opens the browser."""

import threading
import webbrowser

from keyplay.server import app, PORT


def main():
    threading.Timer(0.8, lambda: webbrowser.open(f"http://127.0.0.1:{PORT}/")).start()
    app.run(host="127.0.0.1", port=PORT, debug=False)


if __name__ == "__main__":
    main()
