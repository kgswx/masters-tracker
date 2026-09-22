# Master's application tracker

A small local dashboard for tracking master's-degree applications — deadlines, documents, entry
requirements, fees, scholarships and contacts, one card per course.

Runs entirely on your own machine. Python standard library plus a static web UI, no frameworks, no
accounts, no network calls. Everything lives in a single `data.json` next to the server.

## Running it

Double-click **`Start Dashboard.bat`**, or run:

```bash
python server.py
```

It starts a local server and opens <http://localhost:8123>. Leave the terminal open while you use
it; close it or press `Ctrl+C` to stop. Requires Python 3 on your PATH. macOS and Linux users can
run `python3 server.py` and ignore the `.bat`.

Edits save automatically as you type — there is no save button.

## First run

The tracker ships with one example course showing every field it supports. Edit it into your first
real course, or delete it with the ✕ on the course page and start from scratch.

Then fill in **Profile** with your grades. Entry requirements on each course are checked against
those values automatically, so a course will flag itself as unmet until your profile says otherwise.

## What it tracks

- **Overview** — one card per course: status, next-deadline countdown, document progress, and
  missing-document / unmet-requirement flags. Search, filter by country and status, and sort by
  next deadline, university, programme, country, status or most-documents-missing.
- **Course pages** — documents, useful links (with a bulk-paste box that accepts markdown,
  `Label | url`, or bare URLs), entry requirements, deadlines, costs, scholarships, contacts, an
  activity log and free-text notes.
- **Timeline** — a real horizontal time axis from today to your intake, plotting every deadline,
  scholarship date and log entry, colour-coded by urgency.
- **Profile and shared documents** — grades and scores that feed the requirement checks, plus the
  documents reused across every course (CV, portfolio, transcript, diploma).

## Linking your documents

Course and shared documents can point at real files, and clicking one opens it in its native app.
The file browser is restricted to a single root folder for safety. By default that is your
`Documents` folder; point it somewhere else with an environment variable:

```bash
set MASTERS_DOCS_ROOT=D:\path\to\your\application\documents
```

A cloud-drive mount works fine — Google Drive, OneDrive and Dropbox all appear as ordinary folders.

## Files

| File | Purpose |
|------|---------|
| `server.py` | Local HTTP server: serves the UI, persists `data.json`, browses and opens linked files. |
| `index.html`, `style.css`, `app.js` | The single-page web UI. |
| `data.json` | **Your data.** Profile, shared documents and all courses. Source of truth — back it up. |
| `build_snapshot.py` | Builds a standalone HTML copy with everything inlined, for archiving or sharing. |
| `Start Dashboard.bat` | Convenience launcher for Windows. |
| `dashboard.ico` | Icon, if you want a desktop or taskbar shortcut. |

## A note on your data

`data.json` is the whole tracker and it will fill up with personal information — grades, referee
names, document paths, notes about your applications. It is intentionally not committed to this
template's history.

If you put your own copy in Git, **use a private repository**. If you ever want to share your
version publicly, share it the way this template was made: an orphan branch with the data file
scrubbed, so nothing personal survives anywhere in the history.

## Making a shortcut

Create a shortcut to `Start Dashboard.bat`, then point it at `cmd.exe` so Windows will let you pin
it:

```
Target:   C:\Windows\System32\cmd.exe /c call "C:\path\to\Start Dashboard.bat"
Icon:     C:\path\to\dashboard.ico
```

Routing through `cmd /c call` is necessary because a `.bat` cannot be pinned to the taskbar
directly.
