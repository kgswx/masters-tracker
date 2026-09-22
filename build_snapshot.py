"""Build a standalone, shareable snapshot of the dashboard.

Inlines style.css, app.js and data.json into a single self-contained HTML file that
needs no server. Editing still works in the browser but nothing is persisted, and the
file-open / file-picker actions are stubbed out since they need the local machine.

Emits two files:
  dashboard-snapshot.html   full document — double-click to open locally
  dashboard-artifact.html   body fragment — for publishing as a Claude Artifact

Run:  python build_snapshot.py
"""
import json
from datetime import date
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
STAMP = date.today().strftime("%d %b %Y")

css = (APP_DIR / "style.css").read_text(encoding="utf-8")
js = (APP_DIR / "app.js").read_text(encoding="utf-8")
data = json.loads((APP_DIR / "data.json").read_text(encoding="utf-8"))

# Drop the live data fetch — the snapshot supplies DATA directly.
FETCH_LINE = 'fetch("/api/data").then(r => r.json()).then(d => { DATA = d; route(); });'
if FETCH_LINE not in js:
    raise SystemExit("Could not find the data-fetch line in app.js — has it changed?")
js = js.replace(FETCH_LINE, "// data supplied inline by build_snapshot.py")

# </script> inside the embedded JSON would close the tag early.
data_literal = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")

overrides = f"""
DATA = {data_literal};

// Snapshot mode: keep the UI identical, but nothing writes back and nothing
// touches the local filesystem.
(function () {{
  var badge = document.getElementById("saveState");
  function mark() {{ if (badge) badge.textContent = "Snapshot \\u00b7 {STAMP}"; }}

  save = function () {{ mark(); }};

  openFile = function (path) {{
    alert("Read-only snapshot \\u2014 files can't be opened from here.\\n\\n" + path +
          "\\n\\nRun the live dashboard to open it.");
  }};

  openPicker = function () {{
    alert("Read-only snapshot \\u2014 file linking is only available in the live dashboard.");
  }};

  browseTo = function () {{ return Promise.resolve(); }};

  mark();
  route();
}})();
"""

SNAPSHOT_CSS = """
/* snapshot-only tweaks */
.save-state { min-width: 128px; white-space: nowrap; }
"""

BODY = f"""<title>Masters Applications</title>
<style>
{css}
{SNAPSHOT_CSS}</style>

<header class="topbar">
  <div class="topbar-inner">
    <div class="brand">
      <span class="brand-icon">\U0001F393</span>
      <div>
        <div class="brand-title">Masters Applications</div>
        <div class="brand-sub">Application tracker</div>
      </div>
    </div>
    <nav id="nav"></nav>
    <div class="save-state" id="saveState">Snapshot</div>
  </div>
</header>
<main id="app"></main>

<div class="modal-backdrop hidden" id="modalBackdrop">
  <div class="modal" id="modal"></div>
</div>

<script>
{js}
{overrides}</script>
"""

(APP_DIR / "dashboard-artifact.html").write_text(BODY, encoding="utf-8")

FAVICON = (
    "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>"
    "<text y='0.9em' font-size='90'>\U0001F393</text></svg>"
)
full = (
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    f'<link rel="icon" href="{FAVICON}">\n</head>\n<body>\n{BODY}\n</body>\n</html>\n'
)
(APP_DIR / "dashboard-snapshot.html").write_text(full, encoding="utf-8")

n = len(data.get("courses", []))
print(f"Built snapshot of {n} courses ({STAMP})")
print("  dashboard-snapshot.html  — open locally")
print("  dashboard-artifact.html  — publish as artifact")
