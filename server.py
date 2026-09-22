"""Masters Application Dashboard - tiny local server.

Serves the dashboard UI, persists data.json (on Google Drive, so it syncs),
lets the UI browse Drive folders and open files in their native apps.
Run via "Start Dashboard.bat" or:  python server.py
"""
import json
import os
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

APP_DIR = Path(__file__).resolve().parent
DATA_FILE = APP_DIR / "data.json"
# Where your application documents live. The file browser is restricted to this
# folder, so point it at whatever holds your CV, portfolio and transcripts —
# a Google Drive / OneDrive / Dropbox mount, or just a local folder.
# Override without editing this file:  set MASTERS_DOCS_ROOT=D:\path\to\docs
DRIVE_ROOT = Path(os.environ.get("MASTERS_DOCS_ROOT") or Path.home() / "Documents").resolve()
DEFAULT_BROWSE = DRIVE_ROOT
PORT = 8123
URL = f"http://localhost:{PORT}"

STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
}

HIDDEN_EXT = {".tmp", ".ini", ".lnk"}


def inside_drive(path: Path) -> bool:
    try:
        path.resolve().relative_to(DRIVE_ROOT)
        return True
    except ValueError:
        return False


def load_data() -> dict:
    if DATA_FILE.exists():
        return json.loads(DATA_FILE.read_text(encoding="utf-8"))
    return {"profile": {"metrics": [], "notes": ""}, "sharedDocs": [], "courses": []}


def save_data(data: dict) -> None:
    tmp = DATA_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, DATA_FILE)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code: int, body: bytes, ctype: str = "application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code: int = 200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def do_GET(self):
        parsed = urlparse(self.path)
        route = parsed.path

        if route in STATIC:
            fname, ctype = STATIC[route]
            f = APP_DIR / fname
            if f.exists():
                self._send(200, f.read_bytes(), ctype)
            else:
                self._send(404, b"not found", "text/plain")
            return

        if route == "/api/data":
            self._json(load_data())
            return

        if route == "/api/browse":
            qs = parse_qs(parsed.query)
            raw = qs.get("path", [str(DEFAULT_BROWSE)])[0] or str(DEFAULT_BROWSE)
            target = Path(raw)
            if not target.is_dir() or not inside_drive(target):
                target = DEFAULT_BROWSE
            target = target.resolve()
            dirs, files = [], []
            try:
                for entry in sorted(target.iterdir(), key=lambda p: p.name.lower()):
                    if entry.name.startswith((".", "~$")):
                        continue
                    if entry.is_dir():
                        dirs.append({"name": entry.name, "path": str(entry)})
                    elif entry.suffix.lower() not in HIDDEN_EXT:
                        files.append({"name": entry.name, "path": str(entry)})
            except OSError as e:
                self._json({"error": str(e)}, 500)
                return
            parent = str(target.parent) if target != DRIVE_ROOT else None
            self._json({"path": str(target), "parent": parent, "root": str(DRIVE_ROOT),
                        "dirs": dirs, "files": files})
            return

        self._send(404, b"not found", "text/plain")

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._json({"error": "bad json"}, 400)
            return

        if self.path == "/api/data":
            if not isinstance(payload, dict) or "courses" not in payload:
                self._json({"error": "unexpected data shape, refusing to save"}, 400)
                return
            save_data(payload)
            self._json({"ok": True})
            return

        if self.path == "/api/open":
            raw = payload.get("path", "")
            target = Path(raw)
            if not raw or not inside_drive(target) or not target.exists():
                self._json({"error": f"File not found: {raw}"}, 404)
                return
            os.startfile(str(target.resolve()))  # opens with the Windows default app
            self._json({"ok": True})
            return

        self._send(404, b"not found", "text/plain")


class Server(ThreadingHTTPServer):
    # http.server.HTTPServer sets allow_reuse_address = 1. On Windows that flag
    # lets a SECOND process bind a port already in use instead of failing, so the
    # "already running" check below never fired and every launch stacked up
    # another server on 8123. Turning it off restores the intended behaviour.
    allow_reuse_address = False


def main():
    try:
        server = Server(("127.0.0.1", PORT), Handler)
    except OSError:
        print(f"Dashboard already running - opening {URL}")
        webbrowser.open(URL)
        return
    print(f"Masters dashboard running at {URL}  (Ctrl+C to stop)")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.5, lambda: webbrowser.open(URL)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
