/* Masters Application Dashboard */
"use strict";

let DATA = null;

/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const todayISO = () => new Date().toISOString().slice(0, 10);

const COURSE_STATUSES = {
  researching: ["Researching", "gray"],
  preparing:   ["Preparing", "amber"],
  submitted:   ["Submitted", "blue"],
  interview:   ["Interview", "purple"],
  offer:       ["Offer 🎉", "green"],
  rejected:    ["Rejected", "red"],
  declined:    ["Declined by me", "gray"],
};
const DOC_STATUSES = {
  missing:   ["Missing", "red"],
  draft:     ["Draft", "amber"],
  review:    ["In review", "purple"],
  final:     ["Final", "green"],
  submitted: ["Submitted", "blue"],
};
const SCHOLARSHIP_STATUSES = {
  exploring: ["Exploring", "gray"],
  applying:  ["Applying", "amber"],
  submitted: ["Submitted", "blue"],
  awarded:   ["Awarded 🎉", "green"],
  rejected:  ["Rejected", "red"],
};
const REFEREE_STATUSES = {
  tocontact: ["To contact", "gray"],
  contacted: ["Contacted", "amber"],
  agreed:    ["Agreed ✓", "green"],
  declined:  ["Declined", "red"],
};

function daysLeft(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T23:59:59");
  return Math.ceil((d - new Date()) / 86400000);
}
function fmtDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-GB",
    { day: "numeric", month: "short", year: "numeric" });
}
function deadlineChip(dateStr, label = "") {
  const dl = daysLeft(dateStr);
  if (dl === null) return `<span class="pill gray deadline-chip">no date</span>`;
  if (dl < 0)   return `<span class="pill gray deadline-chip">${label} passed</span>`;
  const color = dl <= 14 ? "red" : dl <= 45 ? "amber" : "gray";
  return `<span class="pill ${color} deadline-chip">${dl}d left</span>`;
}
function statusPillSelect(map, current, attrs) {
  const [, color] = map[current] || ["?", "gray"];
  const opts = Object.entries(map).map(([k, [lbl]]) =>
    `<option value="${k}" ${k === current ? "selected" : ""}>${lbl}</option>`).join("");
  return `<select class="pill ${color} clickable" ${attrs}>${opts}</select>`;
}
function fileName(p) { return (p || "").split(/[\\/]/).pop(); }

/* ---------- data access ---------- */
const course = id => DATA.courses.find(c => c.id === id);
const sharedDoc = id => DATA.sharedDocs.find(d => d.id === id);

function courseAllDocs(c) {
  const own = c.docs.map(d => ({ ...d, shared: false }));
  const shared = (c.sharedDocIds || []).map(sharedDoc).filter(Boolean)
    .map(d => ({ ...d, shared: true }));
  return own.concat(shared);
}
function courseProgress(c) {
  const docs = courseAllDocs(c);
  const done = docs.filter(d => d.status === "final" || d.status === "submitted").length;
  return { done, total: docs.length };
}
function courseMissing(c) {
  return courseAllDocs(c).filter(d => d.status === "missing" || !d.path).length;
}
function nextDeadline(c) {
  const upcoming = (c.deadlines || [])
    .filter(d => d.date && daysLeft(d.date) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  return upcoming[0] || null;
}
function metricById(id) { return DATA.profile.metrics.find(m => m.id === id); }
function firstNumber(s) {
  const m = String(s ?? "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
/* returns "met" | "notmet" | "unknown" */
function reqStatus(req) {
  if (req.metricId) {
    const metric = metricById(req.metricId);
    const have = firstNumber(metric?.value);
    const need = firstNumber(req.required);
    if (have !== null && need !== null) return have >= need ? "met" : "notmet";
    return "unknown";
  }
  return req.manual || "unknown";
}
function courseUnmet(c) {
  return (c.requirements || []).filter(r => reqStatus(r) === "notmet").length;
}

/* ---------- persistence ---------- */
let saveTimer = null;
function save(immediate = false) {
  $("#saveState").textContent = "Saving…";
  $("#saveState").classList.add("saving");
  clearTimeout(saveTimer);
  const doIt = () => fetch("/api/data", { method: "POST", body: JSON.stringify(DATA) })
    .then(r => { if (!r.ok) throw 0; })
    .then(() => { $("#saveState").textContent = "Saved"; $("#saveState").classList.remove("saving"); })
    .catch(() => { $("#saveState").textContent = "⚠ save failed"; });
  if (immediate) doIt(); else saveTimer = setTimeout(doIt, 500);
}

async function openFile(path) {
  const r = await fetch("/api/open", { method: "POST", body: JSON.stringify({ path }) });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    alert(e.error || "Could not open file — has it moved?");
  }
}

/* ---------- routing ---------- */
function route() {
  const h = location.hash;
  if (h.startsWith("#course/")) renderCourse(h.slice(8));
  else if (h === "#timeline") renderTimeline();
  else if (h === "#tiers") renderTiers();
  else if (h === "#profile") renderProfile();
  else renderOverview();
  renderNav();
}
function renderNav() {
  const h = location.hash;
  const tabs = [["", "Overview"], ["#timeline", "Timeline"], ["#tiers", "Tier list"],
                ["#profile", "Profile & shared docs"]];
  $("#nav").innerHTML = tabs.map(([href, lbl]) => {
    const active = href === "" ? (h === "" || h.startsWith("#course/")) : h === href;
    return `<a href="${href || "#"}" class="${active ? "active" : ""}">${lbl}</a>`;
  }).join("");
}

/* ---------- filtering (view state, not persisted) ---------- */
const FILTERS = { q: "", country: "", status: "", sort: "deadline" };
const countryOf = c => ((c.location || "").split(",").pop() || "").trim() || "—";
const filtersActive = () => !!(FILTERS.q.trim() || FILTERS.country || FILTERS.status);

function courseHaystack(c) {
  return [c.university, c.programme, c.location, c.notes,
    ...(c.docs || []).map(d => d.name),
    ...(c.requirements || []).map(r => r.label),
    ...(c.scholarships || []).map(s => s.name),
    ...(c.links || []).map(l => (l.label || "") + " " + (l.url || "")),
  ].join(" ").toLowerCase();
}

const SORTS = {
  deadline:   ["Next deadline",      c => (nextDeadline(c) || {}).date || "9999-12-31"],
  deadlineRev:["Deadline, furthest", c => {
                 const d = (nextDeadline(c) || {}).date;
                 return d ? d.split("").map(ch => String.fromCharCode(255 - ch.charCodeAt(0))).join("") : "";
               }],
  university: ["University A–Z",     c => (c.university || "").toLowerCase()],
  programme:  ["Programme A–Z",      c => (c.programme || "").toLowerCase()],
  country:    ["Country A–Z",        c => countryOf(c).toLowerCase()],
  missing:    ["Most docs missing",  c => -courseMissing(c)],
  status:     ["Status",             c => Object.keys(COURSE_STATUSES).indexOf(c.status)],
  tier:       ["Tier",               c => tierOf(c) || 99],
};

function visibleCourses() {
  const q = FILTERS.q.trim().toLowerCase();
  const list = DATA.courses.filter(c =>
    (!FILTERS.country || countryOf(c) === FILTERS.country) &&
    (!FILTERS.status  || c.status === FILTERS.status) &&
    (!q || courseHaystack(c).includes(q)));
  const key = (SORTS[FILTERS.sort] || SORTS.deadline)[1];
  return list.sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return (a.university || "").localeCompare(b.university || "")
        || (a.programme || "").localeCompare(b.programme || "");
  });
}

/* ---------- useful links ---------- */
/* Accepts bare URLs, "Label | url", "Label - url", tab-separated, and
   [Label](url). Anything without an http(s) URL on the line is skipped. */
function parseLinkLines(text) {
  const out = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let label = "", url = "", m;
    if ((m = line.match(/^\[([^\]]*)\]\(\s*(\S+?)\s*\)$/))) {
      label = m[1].trim(); url = m[2];
    } else if ((m = line.match(/^(.*?)\s*(?:\||\t|\s[-–—]\s)\s*(https?:\/\/\S+)$/i))) {
      label = m[1].trim(); url = m[2];
    } else if ((m = line.match(/(https?:\/\/\S+)/i))) {
      url = m[1];
      label = line.replace(url, " ")
                  .replace(/\s+/g, " ")
                  .replace(/^[\s|\-–—:]+|[\s|\-–—:]+$/g, "").trim();
    } else continue;

    url = url.replace(/[)\].,;]+$/, "");
    if (!/^https?:\/\//i.test(url)) continue;
    if (!label) {
      try { label = new URL(url).hostname.replace(/^www\./, ""); }
      catch { label = url; }
    }
    out.push({ id: uid(), label, url });
  }
  return out;
}

/* ---------- overview ---------- */
function renderOverview() {
  $("#app").innerHTML = `
    <h1>Overview</h1>
    <div class="muted small">Every course you are tracking, at a glance.</div>
    <div id="ovStats"></div>
    ${filterBar()}
    <div id="ovGrid"></div>`;
  refreshOverview();
}

function filterBar() {
  const all = DATA.courses;
  const countries = [...new Set(all.map(countryOf))].sort((a, b) => a.localeCompare(b));
  const countryOpts = countries.map(k =>
    `<option value="${esc(k)}"${FILTERS.country === k ? " selected" : ""}>${esc(k)} (${all.filter(c => countryOf(c) === k).length})</option>`).join("");
  const statusOpts = Object.entries(COURSE_STATUSES).map(([k, [lbl]]) => {
    const n = all.filter(c => c.status === k).length;
    if (!n && FILTERS.status !== k) return "";
    return `<option value="${k}"${FILTERS.status === k ? " selected" : ""}>${lbl} (${n})</option>`;
  }).join("");
  const sortOpts = Object.entries(SORTS).map(([k, [lbl]]) =>
    `<option value="${k}"${FILTERS.sort === k ? " selected" : ""}>${lbl}</option>`).join("");
  return `
    <div class="filter-bar">
      <input class="input-boxed flt-search" type="search" data-filter="q"
             placeholder="Search university, programme, notes…" value="${esc(FILTERS.q)}">
      <select class="input-boxed" data-filter="country" title="Filter by country">
        <option value="">All countries</option>${countryOpts}</select>
      <select class="input-boxed" data-filter="status" title="Filter by status">
        <option value="">All statuses</option>${statusOpts}</select>
      <span class="flt-label">Sort</span>
      <select class="input-boxed" data-filter="sort" title="Sort courses by">${sortOpts}</select>
      <span class="flt-spacer"></span>
      <span id="fltCount" class="small muted"></span>
      <span id="fltClear"></span>
    </div>`;
}

function refreshOverview() {
  if (!$("#ovGrid")) return;
  const all = DATA.courses;
  const shown = visibleCourses();
  const filtered = filtersActive();
  const missingTotal = shown.reduce((n, c) => n + courseMissing(c), 0);
  const unmetTotal = shown.reduce((n, c) => n + courseUnmet(c), 0);
  const soonest = shown.map(c => ({ c, d: nextDeadline(c) })).filter(x => x.d)
    .sort((a, b) => a.d.date.localeCompare(b.d.date))[0];

  $("#ovStats").innerHTML = `
    <div class="stats-row">
      <div class="card stat">
        <div class="stat-label">Courses</div>
        <div class="stat-value">${shown.length}</div>
        <div class="stat-sub">${filtered ? `of ${all.length} total`
          : `${all.filter(c => c.status === "submitted").length} submitted`}</div>
      </div>
      <div class="card stat">
        <div class="stat-label">Next deadline</div>
        <div class="stat-value ${soonest && daysLeft(soonest.d.date) <= 14 ? "red" : soonest && daysLeft(soonest.d.date) <= 45 ? "amber" : ""}">
          ${soonest ? daysLeft(soonest.d.date) + " days" : "—"}</div>
        <div class="stat-sub">${soonest ? esc(soonest.c.university) + " · " + fmtDate(soonest.d.date) : "no upcoming deadlines"}</div>
      </div>
      <div class="card stat">
        <div class="stat-label">Docs missing</div>
        <div class="stat-value ${missingTotal ? "red" : "green"}">${missingTotal}</div>
        <div class="stat-sub">${filtered ? "across shown courses" : "across all courses"}</div>
      </div>
      <div class="card stat">
        <div class="stat-label">Requirements unmet</div>
        <div class="stat-value ${unmetTotal ? "amber" : "green"}">${unmetTotal}</div>
        <div class="stat-sub">check Profile to update your grades</div>
      </div>
    </div>`;

  const cnt = $("#fltCount");
  if (cnt) cnt.textContent = filtered ? `Showing ${shown.length} of ${all.length}` : `${all.length} courses`;
  const cl = $("#fltClear");
  if (cl) cl.innerHTML = filtered
    ? `<button class="btn ghost sm" data-action="clear-filters">✕ clear</button>` : "";

  const cards = shown.map(c => {
    const [stLbl, stColor] = COURSE_STATUSES[c.status] || ["?", "gray"];
    const p = courseProgress(c);
    const nd = nextDeadline(c);
    const pct = p.total ? Math.round(p.done / p.total * 100) : 0;
    const missing = courseMissing(c);
    const unmet = courseUnmet(c);
    return `
    <div class="card course-card" data-action="open-course" data-cid="${c.id}">
      <div class="card-pad">
        <div class="meta-row">
          <span class="pill ${stColor}">${stLbl}</span>
          ${nd ? deadlineChip(nd.date) : `<span class="pill gray">no deadline set</span>`}
          <span class="pill gray flt-country">${esc(countryOf(c))}</span>
          ${tierOf(c) ? `<span class="pill tier-pill t${tierOf(c)}">Tier ${tierOf(c)}</span>` : ""}
        </div>
        <div>
          <div class="uni">${esc(c.university) || "Untitled university"}</div>
          <div class="prog">${esc(c.programme) || "—"}</div>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="foot">
          <span>${p.done}/${p.total} documents ready</span>
          <span>
            ${missing ? `<span class="pill red">${missing} missing</span>` : ""}
            ${unmet ? `<span class="pill amber">${unmet} req unmet</span>` : ""}
            ${!missing && !unmet && p.total ? `<span class="pill green">on track</span>` : ""}
          </span>
        </div>
      </div>
    </div>`;
  }).join("");

  $("#ovGrid").innerHTML = `
    <div class="course-grid">
      ${cards || `<div class="card empty-note" style="grid-column:1/-1">No courses match these filters.</div>`}
      ${filtered ? "" : `<div class="add-card" data-action="add-course">＋ Add course</div>`}
    </div>`;
}

/* ---------- tier list ---------- */
/* A course's rank lives on the course itself: `tier` (1-5) and `tierPos`
   (order within that tier). Anything without a valid tier sits in the pool. */
const TIER_LABELS = {
  1: ["Tier 1", "Applying, no question"],
  2: ["Tier 2", "Strong — likely applying"],
  3: ["Tier 3", "Interested, undecided"],
  4: ["Tier 4", "Backup / long shot"],
  5: ["Tier 5", "Probably not"],
};
let EXPANDED_CHIP = null;   // which chip is showing full detail (view state)
const tierOf = c => {
  const t = Number(c.tier);
  return t >= 1 && t <= 5 ? t : null;
};
function tierMembers(t) {
  if (t == null) {
    return DATA.courses.filter(c => !tierOf(c))
      .sort((x, y) => (x.university || "").localeCompare(y.university || ""));
  }
  return DATA.courses.filter(c => tierOf(c) === t)
    .sort((x, y) => (x.tierPos ?? 1e9) - (y.tierPos ?? 1e9)
                 || (x.university || "").localeCompare(y.university || ""));
}

/* Chips are tiny, so the university is abbreviated and the programme is cut
   to its own acronym where it has one. Full detail is one click away. */
const UNI_SHORT = [
  ["Royal College of Art", "RCA × Imperial"],   // before the Imperial rule
  ["University College London", "UCL"],
  ["Massachusetts Institute of Technology", "MIT"],
  ["Carnegie Mellon", "CMU"],
  ["Cornell Tech", "Cornell Tech"],
  ["New York University", "NYU"],
  ["University of California, Berkeley", "Berkeley"],
  ["Singapore University of Technology and Design", "SUTD"],
  ["Imperial College London", "Imperial"],
  ["Technical University of Munich", "TUM"],
  ["Eindhoven University of Technology", "TU/e"],
  ["University of Oxford", "Oxford"],
  ["Lund University", "Lund"],
  ["Aalto University", "Aalto"],
  ["ETH Zurich", "ETH"],
  ["TU Delft", "TU Delft"],
  ["TU Wien", "TU Wien"],
  ["IAAC", "IAAC"],
];
function shortUni(u) {
  const s = u || "";
  for (const [needle, abbr] of UNI_SHORT) if (s.includes(needle)) return abbr;
  const paren = s.match(/\(([A-Z][A-Za-z/]{1,7})\)\s*$/);   // trailing acronym
  if (paren) return paren[1];
  return s.replace(/\s*\([^)]*\)\s*/g, " ").trim() || "Untitled";
}
function shortProg(p) {
  const s = p || "";
  const acro = s.match(/\(([A-Z][A-Z/]{1,6})\)/);           // ESDA, MIBS, BSE, IDE…
  if (acro) return acro[1];
  return s.replace(/^(MSc|MS|MA|MPhil|SMArchS|Master(?:'s)?|Msc)\b[\s/]*(\(Tech\)\s*)?(in\s+)?/i, "")
          .split(/\s+[—–-]\s+|\s*\(/)[0]
          .trim() || "—";
}

function tierChip(c) {
  const expanded = EXPANDED_CHIP === c.id;
  if (!expanded) {
    return `
      <button class="tier-chip" draggable="true" data-chip="${c.id}"
              data-action="toggle-chip" data-cid="${c.id}"
              title="${esc(c.university)} — ${esc(c.programme)}">
        <span class="tc-uni">${esc(shortUni(c.university))}</span>
        <span class="tc-prog">${esc(shortProg(c.programme))}</span>
      </button>`;
  }
  const [stLbl, stColor] = COURSE_STATUSES[c.status] || ["?", "gray"];
  const nd = nextDeadline(c);
  const p = courseProgress(c);
  const tierBtns = [1, 2, 3, 4, 5].map(t =>
    `<button class="tc-tier t${t} ${tierOf(c) === t ? "on" : ""}"
             data-action="set-tier" data-cid="${c.id}" data-tier="${t}"
             title="Move to tier ${t}">${t}</button>`).join("");
  return `
    <div class="tier-chip expanded" draggable="true" data-chip="${c.id}">
      <div class="tce-head">
        <div>
          <div class="tce-uni">${esc(c.university) || "Untitled university"}</div>
          <div class="tce-prog">${esc(c.programme) || "—"}</div>
        </div>
        <button class="icon-btn" data-action="toggle-chip" data-cid="" title="Collapse">✕</button>
      </div>
      <div class="meta-row">
        <span class="pill ${stColor}">${stLbl}</span>
        ${nd ? deadlineChip(nd.date) : `<span class="pill gray">no deadline set</span>`}
        <span class="pill gray">${esc(countryOf(c))}</span>
        <span class="pill gray">${p.done}/${p.total} docs</span>
      </div>
      <div class="tce-foot">
        <span class="tce-tiers">${tierBtns}
          <button class="tc-tier clear ${tierOf(c) ? "" : "on"}"
                  data-action="set-tier" data-cid="${c.id}" data-tier=""
                  title="Remove from all tiers">—</button></span>
        <button class="btn ghost sm" data-action="goto-course" data-cid="${c.id}">Open course →</button>
      </div>
    </div>`;
}

function renderTiers() {
  EXPANDED_CHIP = null;
  $("#app").innerHTML = `
    <h1>Tier list</h1>
    <div class="muted small">Drag a course into a tier. Click one to see the detail
      and set its tier without dragging. Ranks are saved with everything else and
      shown as a pill on the Overview cards.</div>
    <div id="tierBoard"></div>`;
  refreshTiers();
}

function refreshTiers() {
  const board = $("#tierBoard");
  if (!board) return;
  const ranked = DATA.courses.filter(c => tierOf(c)).length;
  const rows = Object.entries(TIER_LABELS).map(([t, [lbl, sub]]) => {
    const members = tierMembers(Number(t));
    return `
      <div class="tier-row">
        <div class="tier-badge t${t}">
          <div class="tb-name">${lbl}</div>
          <div class="tb-sub">${esc(sub)}</div>
          <div class="tb-count">${members.length}</div>
        </div>
        <div class="tier-lane" data-tier="${t}">
          ${members.map(tierChip).join("") ||
            `<div class="tier-empty">Drop courses here</div>`}
        </div>
      </div>`;
  }).join("");

  const pool = tierMembers(null);
  board.innerHTML = `
    <div class="tier-head">
      <span class="small muted">${ranked} of ${DATA.courses.length} courses ranked</span>
      <span class="flt-spacer"></span>
      ${ranked ? `<button class="btn ghost sm" data-action="clear-tiers">✕ clear all</button>` : ""}
    </div>
    <div class="tier-board">${rows}</div>
    <h2 class="tier-pool-head">Unranked <span class="muted small">(${pool.length})</span></h2>
    <div class="tier-lane tier-pool" data-tier="">
      ${pool.map(tierChip).join("") || `<div class="tier-empty">Everything is ranked.</div>`}
    </div>`;
}

/* Move `cid` into `tier` (null = back to the pool) at position `index`,
   then renumber that tier so the order survives a reload. */
function setTier(cid, tier, index) {
  const c = course(cid);
  if (!c) return;
  const others = tierMembers(tier).filter(x => x.id !== cid);
  if (tier == null) {
    delete c.tier;
    delete c.tierPos;
  } else {
    c.tier = tier;
    others.splice(Math.max(0, Math.min(index ?? others.length, others.length)), 0, c);
    others.forEach((x, i) => { x.tierPos = i; });
  }
  save();
  refreshTiers();
}

/* ---------- tier drag and drop ---------- */
let dragCid = null;

function tierInsertIndex(lane, x, y) {
  const chips = [...lane.querySelectorAll(".tier-chip")].filter(ch => ch.dataset.chip !== dragCid);
  for (let i = 0; i < chips.length; i++) {
    const r = chips[i].getBoundingClientRect();
    if (y < r.top) return i;                                   // pointer is on an earlier line
    if (y <= r.bottom && x < r.left + r.width / 2) return i;    // same line, left half
  }
  return chips.length;
}

document.addEventListener("dragstart", e => {
  const chip = e.target.closest && e.target.closest(".tier-chip");
  if (!chip) return;
  dragCid = chip.dataset.chip;
  chip.classList.add("dragging");
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", dragCid); } catch (_) {}
  }
});
document.addEventListener("dragend", () => {
  dragCid = null;
  document.querySelectorAll(".tier-chip.dragging").forEach(x => x.classList.remove("dragging"));
  document.querySelectorAll(".tier-lane.over").forEach(x => x.classList.remove("over"));
});
document.addEventListener("dragover", e => {
  const lane = e.target.closest && e.target.closest(".tier-lane");
  if (!lane || !dragCid) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  lane.classList.add("over");
});
document.addEventListener("dragleave", e => {
  const lane = e.target.closest && e.target.closest(".tier-lane");
  if (lane && !lane.contains(e.relatedTarget)) lane.classList.remove("over");
});
document.addEventListener("drop", e => {
  const lane = e.target.closest && e.target.closest(".tier-lane");
  if (!lane || !dragCid) return;
  e.preventDefault();
  const raw = lane.dataset.tier;
  setTier(dragCid, raw === "" ? null : Number(raw), tierInsertIndex(lane, e.clientX, e.clientY));
  dragCid = null;
});

/* ---------- timeline ---------- */
const INTAKE_DATE = "2027-09-01";

function renderVisualTimeline(items, logs) {
  const t = s => new Date(s + "T12:00:00").getTime();
  const all = [todayISO(), INTAKE_DATE].concat(items.map(i => i.date), logs.map(l => l.date));
  const minD = all.reduce((a, b) => a < b ? a : b);
  const maxD = all.reduce((a, b) => a > b ? a : b);
  const d0 = new Date(t(minD)), d1 = new Date(t(maxD));
  const start = new Date(d0.getFullYear(), d0.getMonth(), 1);
  const endExcl = new Date(d1.getFullYear(), d1.getMonth() + 1, 1);
  const T0 = start.getTime(), T1 = endExcl.getTime();
  const pos = ms => (ms - T0) / (T1 - T0) * 100;

  const months = [];
  for (let m = new Date(start); m < endExcl; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
    const mid = new Date(m.getFullYear(), m.getMonth(), 15);
    months.push({
      tickPct: pos(m.getTime()),
      labelPct: pos(mid.getTime()),
      label: m.toLocaleDateString("en-GB", { month: "short" }) +
        (m.getMonth() === 0 || m.getTime() === start.getTime() ? " ’" + String(m.getFullYear()).slice(2) : ""),
    });
  }
  const minW = Math.max(760, months.length * 92);

  // assign stacking lanes so cards don't overlap
  const sorted = items.slice().sort((a, b) => a.date.localeCompare(b.date));
  const threshold = 175 / minW * 100;
  const laneLast = [];
  for (const e of sorted) {
    e.pct = pos(t(e.date));
    let lane = laneLast.findIndex(p => e.pct - p > threshold);
    if (lane === -1) lane = laneLast.length < 3 ? laneLast.length : laneLast.indexOf(Math.min(...laneLast));
    laneLast[lane] = e.pct;
    e.lane = lane;
  }
  const maxLane = sorted.reduce((n, e) => Math.max(n, e.lane), 0);
  const height = 66 + 18 + maxLane * 72 + 66 + 34;

  const ticks = months.map(m => `
    <div class="vtl-tick" style="left:${m.tickPct}%"></div>
    <div class="vtl-month" style="left:${m.labelPct}%">${m.label}</div>`).join("");

  const marks = `
    <div class="vtl-mark vtl-today" style="left:${pos(t(todayISO()))}%"><span>Today</span></div>
    <div class="vtl-mark vtl-intake" style="left:${pos(t(INTAKE_DATE))}%"><span>🎓 Intake</span></div>`;

  const eventEls = sorted.map(e => {
    const dl = daysLeft(e.date);
    const urg = dl < 0 ? "u-past" : dl <= 14 ? "u-red" : dl <= 45 ? "u-amber" : "u-ok";
    const stem = 18 + e.lane * 72;
    return `
    <div class="vtl-event ${urg} ${e.kind === "scholarship" ? "u-sch" : ""}" style="left:${e.pct}%">
      <div class="vtl-card" data-action="open-course" data-cid="${e.cid}">
        <div class="vtl-when">${fmtDate(e.date)}${dl >= 0 ? ` · ${dl}d` : ""}</div>
        <div class="vtl-label" title="${esc(e.label)}">${esc(e.label)}</div>
        <div class="vtl-who">${esc(e.who)}</div>
      </div>
      <div class="vtl-stem" style="height:${stem}px"></div>
      <div class="vtl-dot"></div>
    </div>`;
  }).join("");

  const logEls = logs.map(l => `
    <div class="vtl-logdot" style="left:${pos(t(l.date))}%" data-action="open-course" data-cid="${l.cid}"
      title="${esc(fmtDate(l.date))} — ${esc(l.text || "log entry")} (${esc(l.who)})"></div>`).join("");

  return `
    <div class="card vtl-outer" style="margin-top:20px">
      <div class="vtl-scroll">
        <div class="vtl" style="min-width:${minW}px;height:${height}px">
          ${ticks}<div class="vtl-axis"></div>${marks}${eventEls}${logEls}
        </div>
      </div>
      <div class="vtl-legend">
        <span><i class="dot" style="background:var(--red)"></i> ≤ 14 days</span>
        <span><i class="dot" style="background:var(--amber)"></i> ≤ 45 days</span>
        <span><i class="dot" style="background:var(--accent)"></i> later</span>
        <span><i class="dot" style="background:var(--purple)"></i> scholarship</span>
        <span><i class="dot dot-sm" style="background:var(--text-3)"></i> activity log</span>
      </div>
    </div>`;
}

function renderTimeline() {
  const items = [];
  const logs = [];
  for (const c of visibleCourses()) {
    const uni = c.university || "Untitled";
    for (const d of c.deadlines || []) if (d.date)
      items.push({ date: d.date, label: d.label || "Deadline", who: uni, cid: c.id, kind: "deadline" });
    for (const s of c.scholarships || []) if (s.deadline)
      items.push({ date: s.deadline, label: `Scholarship: ${s.name || "unnamed"}`, who: uni, cid: c.id, kind: "scholarship" });
    for (const l of c.log || []) if (l.date)
      logs.push({ date: l.date, text: l.text, who: uni, cid: c.id });
  }
  items.sort((a, b) => a.date.localeCompare(b.date));
  let html = `<h1>Timeline</h1><div class="muted small">Every tracked date from today onwards.</div>`;
  if (filtersActive()) html += `<div class="filter-notice">Filtered view — ${visibleCourses().length} of ${DATA.courses.length} courses. <button class="btn ghost sm" data-action="clear-filters">✕ clear filters</button></div>`;
  html += renderVisualTimeline(items, logs);
  if (!items.length) html += `<div class="card empty-note" style="margin-top:20px">No dated deadlines yet — add them on each course page.</div>`;
  else html += `<h2 style="margin-top:26px">All dates</h2>`;
  let lastMonth = "";
  let rows = "";
  const flush = () => { if (rows) { html += `<div class="card row-list" style="margin-bottom:6px">${rows}</div>`; rows = ""; } };
  for (const it of items) {
    const month = new Date(it.date + "T12:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    if (month !== lastMonth) { flush(); html += `<div class="tl-month">${month}</div>`; lastMonth = month; }
    const past = daysLeft(it.date) < 0;
    rows += `
      <div class="tl-row ${past ? "tl-past" : ""}">
        <div class="tl-date">${fmtDate(it.date)}</div>
        ${deadlineChip(it.date)}
        <div class="grow">${esc(it.label)}</div>
        <a href="#course/${it.cid}" class="pill ${it.kind === "scholarship" ? "purple" : "accent"} clickable" style="text-decoration:none">${esc(it.who)}</a>
      </div>`;
  }
  flush();
  $("#app").innerHTML = html;
  const sc = $(".vtl-scroll"), today = $(".vtl-today");
  if (sc && today && sc.scrollWidth > sc.clientWidth)
    sc.scrollLeft = Math.max(0, today.offsetLeft - sc.clientWidth * 0.2);
}

/* ---------- profile & shared docs ---------- */
function renderProfile() {
  const metricRows = DATA.profile.metrics.map(m => `
    <div class="row">
      <input class="grow" value="${esc(m.label)}" placeholder="e.g. Bachelor GPA" data-edit="metric:label" data-id="${m.id}">
      <input style="width:180px" class="input-boxed" value="${esc(m.value)}" placeholder="value, e.g. 7.4" data-edit="metric:value" data-id="${m.id}">
      <button class="icon-btn" data-action="del-metric" data-id="${m.id}" title="Remove">✕</button>
    </div>`).join("");

  const docRows = DATA.sharedDocs.map(d => `
    <div class="doc-block">
      <div class="row no-border">
        <input class="grow" value="${esc(d.name)}" placeholder="Document name" data-edit="shareddoc:name" data-id="${d.id}">
        ${statusPillSelect(DOC_STATUSES, d.status, `data-edit="shareddoc:status" data-id="${d.id}"`)}
        ${d.path
          ? `<span class="file-link" data-action="open-file" data-path="${esc(d.path)}" title="${esc(d.path)}">📄 ${esc(fileName(d.path))}</span>
             <button class="btn ghost sm" data-action="pick-file" data-target="shareddoc" data-id="${d.id}">change</button>`
          : `<button class="btn sm" data-action="pick-file" data-target="shareddoc" data-id="${d.id}">🔗 link file</button>`}
        <button class="icon-btn" data-action="del-shareddoc" data-id="${d.id}" title="Remove">✕</button>
      </div>
      <div class="note-row">
        <input class="note-input" value="${esc(d.note)}" placeholder="💬 add comment — what's missing, next steps…" data-edit="shareddoc:note" data-id="${d.id}">
      </div>
    </div>`).join("");

  const refRows = (DATA.profile.referees || []).map(r => `
    <div class="doc-block">
      <div class="row no-border">
        <input style="width:190px" value="${esc(r.name)}" placeholder="Name" data-edit="referee:name" data-id="${r.id}">
        <input class="grow" value="${esc(r.role)}" placeholder="Role / affiliation" data-edit="referee:role" data-id="${r.id}">
        <input style="width:210px" class="input-boxed" value="${esc(r.email)}" placeholder="email" data-edit="referee:email" data-id="${r.id}">
        ${statusPillSelect(REFEREE_STATUSES, r.status, `data-edit="referee:status" data-id="${r.id}"`)}
        <button class="icon-btn" data-action="del-referee" data-id="${r.id}" title="Remove">✕</button>
      </div>
      <div class="note-row">
        <input class="note-input" value="${esc(r.note)}" placeholder="💬 which courses need them, letterhead needed, reminders…" data-edit="referee:note" data-id="${r.id}">
      </div>
    </div>`).join("");

  $("#app").innerHTML = `
    <h1>Profile & shared documents</h1>
    <div class="muted small">Your grades feed the requirement checks; shared documents are reused across every course.</div>
    <div class="grid grid-2" style="margin-top:20px">
      <div class="card">
        <div class="card-head"><h2>My grades & scores</h2>
          <button class="btn sm" data-action="add-metric">＋ Add</button></div>
        <div class="row-list">${metricRows || `<div class="empty-note">Add your GPA, IELTS score, degree title…</div>`}</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Shared documents</h2>
          <button class="btn sm" data-action="add-shareddoc">＋ Add</button></div>
        <div class="row-list">${docRows || `<div class="empty-note">CV, transcript, diploma, IELTS certificate…</div>`}</div>
      </div>
    </div>
    <div class="card" style="margin-top:18px">
      <div class="card-head"><h2>Referees</h2>
        <button class="btn sm" data-action="add-referee">＋ Add</button></div>
      <div class="row-list">${refRows || `<div class="empty-note">Line up your academic referees here — most courses ask for one or two.</div>`}</div>
    </div>
    <div class="card" style="margin-top:18px">
      <div class="card-head"><h2>Notes</h2></div>
      <div class="card-pad"><textarea data-edit="profile:notes" placeholder="Anything general — test bookings, referee reminders…">${esc(DATA.profile.notes)}</textarea></div>
    </div>`;
}

/* ---------- course detail ---------- */
function renderCourse(cid) {
  const c = course(cid);
  if (!c) { location.hash = ""; return; }

  const linkRows = (c.links || []).map(l => `
    <div class="row">
      <input class="lnk-label" value="${esc(l.label)}" placeholder="Label"
             data-edit="link:label" data-cid="${c.id}" data-id="${l.id}">
      <input class="grow" value="${esc(l.url)}" placeholder="https://…"
             data-edit="link:url" data-cid="${c.id}" data-id="${l.id}">
      ${/^https?:\/\//i.test(l.url || "")
        ? `<a class="btn ghost sm" href="${esc(l.url)}" target="_blank" rel="noopener" title="Open in browser">↗</a>`
        : ""}
      <button class="icon-btn" data-action="del-link" data-cid="${c.id}" data-id="${l.id}" title="Remove">✕</button>
    </div>`).join("");

  const ownDocRows = c.docs.map(d => `
    <div class="doc-block">
      <div class="row no-border">
        <input class="grow" value="${esc(d.name)}" placeholder="Document name" data-edit="doc:name" data-cid="${c.id}" data-id="${d.id}">
        ${statusPillSelect(DOC_STATUSES, d.status, `data-edit="doc:status" data-cid="${c.id}" data-id="${d.id}"`)}
        ${d.path
          ? `<span class="file-link" data-action="open-file" data-path="${esc(d.path)}" title="${esc(d.path)}">📄 ${esc(fileName(d.path))}</span>
             <button class="btn ghost sm" data-action="pick-file" data-target="doc" data-cid="${c.id}" data-id="${d.id}">change</button>`
          : `<button class="btn sm" data-action="pick-file" data-target="doc" data-cid="${c.id}" data-id="${d.id}">🔗 link file</button>`}
        <button class="icon-btn" data-action="del-doc" data-cid="${c.id}" data-id="${d.id}" title="Remove">✕</button>
      </div>
      <div class="note-row">
        <input class="note-input" value="${esc(d.note)}" placeholder="💬 add comment — what's missing, next steps…" data-edit="doc:note" data-cid="${c.id}" data-id="${d.id}">
      </div>
    </div>`).join("");

  const sharedRows = DATA.sharedDocs.map(d => {
    const needed = (c.sharedDocIds || []).includes(d.id);
    const [lbl, color] = DOC_STATUSES[d.status] || ["?", "gray"];
    return `
    <div class="doc-block" style="${needed ? "" : "opacity:.5"}">
      <div class="row no-border">
        <input type="checkbox" ${needed ? "checked" : ""} data-action="toggle-shared" data-cid="${c.id}" data-id="${d.id}" title="Needed for this course?">
        <span class="grow">${esc(d.name)}</span>
        <span class="pill ${color}">${lbl}</span>
        ${d.path ? `<span class="file-link" data-action="open-file" data-path="${esc(d.path)}">📄 ${esc(fileName(d.path))}</span>` : `<span class="small muted">no file</span>`}
      </div>
      ${d.note ? `<div class="note-row note-ro" title="Edit on the Profile & shared docs page">💬 ${esc(d.note)}</div>` : ""}
    </div>`;
  }).join("");

  const reqRows = (c.requirements || []).map(r => {
    const st = reqStatus(r);
    const badge = st === "met" ? `<span class="pill green">✓ met</span>`
      : st === "notmet" ? `<span class="pill red">✗ not met</span>`
      : `<span class="pill gray">?</span>`;
    const metricOpts = [`<option value="">manual check</option>`]
      .concat(DATA.profile.metrics.map(m =>
        `<option value="${m.id}" ${r.metricId === m.id ? "selected" : ""}>vs ${esc(m.label)}</option>`)).join("");
    return `
    <div class="row">
      <input class="grow" value="${esc(r.label)}" placeholder="e.g. GPA ≥ 7.0" data-edit="req:label" data-cid="${c.id}" data-id="${r.id}">
      <input style="width:90px" class="input-boxed" value="${esc(r.required)}" placeholder="required" data-edit="req:required" data-cid="${c.id}" data-id="${r.id}">
      <select data-edit="req:metricId" data-cid="${c.id}" data-id="${r.id}" class="small">${metricOpts}</select>
      <span ${r.metricId ? "" : `class="clickable" data-action="cycle-met" data-cid="${c.id}" data-id="${r.id}" style="cursor:pointer"`}>${badge}</span>
      <button class="icon-btn" data-action="del-req" data-cid="${c.id}" data-id="${r.id}" title="Remove">✕</button>
    </div>`;
  }).join("");

  const dlRows = (c.deadlines || []).map(d => `
    <div class="row">
      <input class="grow" value="${esc(d.label)}" placeholder="e.g. Application deadline" data-edit="deadline:label" data-cid="${c.id}" data-id="${d.id}">
      <input type="date" value="${esc(d.date)}" data-edit="deadline:date" data-cid="${c.id}" data-id="${d.id}">
      ${deadlineChip(d.date)}
      <button class="icon-btn" data-action="del-deadline" data-cid="${c.id}" data-id="${d.id}" title="Remove">✕</button>
    </div>`).join("");

  const schRows = (c.scholarships || []).map(s => `
    <div class="row">
      <input class="grow" value="${esc(s.name)}" placeholder="Scholarship name" data-edit="sch:name" data-cid="${c.id}" data-id="${s.id}">
      <input style="width:100px" class="input-boxed" value="${esc(s.amount)}" placeholder="amount" data-edit="sch:amount" data-cid="${c.id}" data-id="${s.id}">
      <input type="date" value="${esc(s.deadline)}" data-edit="sch:deadline" data-cid="${c.id}" data-id="${s.id}">
      ${statusPillSelect(SCHOLARSHIP_STATUSES, s.status, `data-edit="sch:status" data-cid="${c.id}" data-id="${s.id}"`)}
      <button class="icon-btn" data-action="del-sch" data-cid="${c.id}" data-id="${s.id}" title="Remove">✕</button>
    </div>`).join("");

  const contactRows = (c.contacts || []).map(k => `
    <div class="row">
      <input style="width:160px" value="${esc(k.name)}" placeholder="Name" data-edit="contact:name" data-cid="${c.id}" data-id="${k.id}">
      <input style="width:140px" value="${esc(k.role)}" placeholder="Role" data-edit="contact:role" data-cid="${c.id}" data-id="${k.id}">
      <input class="grow" value="${esc(k.email)}" placeholder="email / phone" data-edit="contact:email" data-cid="${c.id}" data-id="${k.id}">
      <button class="icon-btn" data-action="del-contact" data-cid="${c.id}" data-id="${k.id}" title="Remove">✕</button>
    </div>`).join("");

  const logRows = (c.log || []).slice().reverse().map(l => `
    <div class="row">
      <input type="date" value="${esc(l.date)}" data-edit="log:date" data-cid="${c.id}" data-id="${l.id}">
      <input class="grow" value="${esc(l.text)}" placeholder="What happened?" data-edit="log:text" data-cid="${c.id}" data-id="${l.id}">
      <button class="icon-btn" data-action="del-log" data-cid="${c.id}" data-id="${l.id}" title="Remove">✕</button>
    </div>`).join("");

  $("#app").innerHTML = `
    <a href="#" class="back-link">← All courses</a>
    <div class="detail-header">
      <div class="titles">
        <input class="title-input" value="${esc(c.university)}" placeholder="University" data-edit="course:university" data-cid="${c.id}">
        <input class="sub-input" value="${esc(c.programme)}" placeholder="Programme name" data-edit="course:programme" data-cid="${c.id}">
        <input class="sub-input small" value="${esc(c.location)}" placeholder="City, country" data-edit="course:location" data-cid="${c.id}">
      </div>
      ${statusPillSelect(COURSE_STATUSES, c.status, `data-edit="course:status" data-cid="${c.id}" style="font-size:13px;padding:5px 12px"`)}
      ${c.portalUrl ? `<a class="btn sm" href="${esc(c.portalUrl)}" target="_blank">↗ portal</a>` : ""}
      <button class="btn ghost sm danger" data-action="del-course" data-cid="${c.id}">delete</button>
    </div>

    <div class="grid grid-2">
      <div class="grid" style="align-content:start">
        <div class="card">
          <div class="card-head"><h2>Documents</h2>
            <button class="btn sm" data-action="add-doc" data-cid="${c.id}">＋ Add</button></div>
          <div class="row-list">
            ${ownDocRows || `<div class="empty-note">Motivation letter, portfolio variant, essays…</div>`}
            ${DATA.sharedDocs.length ? `<div class="section-note">Shared documents (tick = required here)</div>${sharedRows}` : ""}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Entry requirements</h2>
            <button class="btn sm" data-action="add-req" data-cid="${c.id}">＋ Add</button></div>
          <div class="row-list">${reqRows || `<div class="empty-note">GPA, IELTS, prerequisite degree… link to a profile metric for auto-check.</div>`}</div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Notes</h2></div>
          <div class="card-pad"><textarea data-edit="course:notes" data-cid="${c.id}" placeholder="Programme specifics, why this course…">${esc(c.notes)}</textarea></div>
        </div>
      </div>

      <div class="grid" style="align-content:start">
        <div class="card">
          <div class="card-head"><h2>Deadlines</h2>
            <button class="btn sm" data-action="add-deadline" data-cid="${c.id}">＋ Add</button></div>
          <div class="row-list">${dlRows || `<div class="empty-note">No deadlines yet.</div>`}</div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Costs</h2></div>
          <div class="field-grid">
            <label>Application fee</label><input value="${esc(c.fees?.application)}" placeholder="e.g. €100" data-edit="course:fees.application" data-cid="${c.id}">
            <label>Tuition / year</label><input value="${esc(c.fees?.tuition)}" placeholder="e.g. €2,530 (EU)" data-edit="course:fees.tuition" data-cid="${c.id}">
            <label>Portal URL</label><input value="${esc(c.portalUrl)}" placeholder="https://…" data-edit="course:portalUrl" data-cid="${c.id}">
          </div>
          <div class="card-head" style="border-top:1px solid var(--border);border-bottom:none"><h2>Scholarships</h2>
            <button class="btn sm" data-action="add-sch" data-cid="${c.id}">＋ Add</button></div>
          <div class="row-list">${schRows || `<div class="empty-note">None tracked yet.</div>`}</div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Useful links</h2>
            <button class="btn sm" data-action="add-link" data-cid="${c.id}">＋ Add</button></div>
          <div class="row-list">${linkRows ||
            `<div class="empty-note">Course page, fees, modules, scholarships, forum threads…</div>`}</div>
          <div class="paste-box">
            <textarea id="linkPaste" rows="3"
              placeholder="Paste links here, one per line — bare URLs, &quot;Label | url&quot;, or [Label](url)"></textarea>
            <button class="btn sm" data-action="paste-links" data-cid="${c.id}">＋ Add pasted links</button>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Contacts</h2>
            <button class="btn sm" data-action="add-contact" data-cid="${c.id}">＋ Add</button></div>
          <div class="row-list">${contactRows || `<div class="empty-note">Admissions office, referees…</div>`}</div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Activity log</h2>
            <button class="btn sm" data-action="add-log" data-cid="${c.id}">＋ Add entry</button></div>
          <div class="row-list">${logRows || `<div class="empty-note">Emails sent, calls, portal updates…</div>`}</div>
        </div>
      </div>
    </div>`;
}

/* ---------- file picker modal ---------- */
let pickerCallback = null;
async function openPicker(startPath, cb) {
  pickerCallback = cb;
  await browseTo(startPath || "");
  $("#modalBackdrop").classList.remove("hidden");
}
function closePicker() {
  $("#modalBackdrop").classList.add("hidden");
  pickerCallback = null;
}
async function browseTo(path) {
  const r = await fetch("/api/browse?path=" + encodeURIComponent(path || ""));
  const listing = await r.json();
  const crumbs = `
    <div class="crumbs">
      ${listing.parent ? `<a data-action="browse" data-path="${esc(listing.parent)}">↑ up</a><span>·</span>` : ""}
      <span>${esc(listing.path.replace(listing.root, "Documents"))}</span>
    </div>`;
  const dirItems = listing.dirs.map(d =>
    `<div class="browse-item" data-action="browse" data-path="${esc(d.path)}">📁 ${esc(d.name)}</div>`).join("");
  const fileItems = listing.files.map(f =>
    `<div class="browse-item" data-action="choose-file" data-path="${esc(f.path)}">📄 ${esc(f.name)}
      <span class="ext">${esc(f.name.split(".").pop())}</span></div>`).join("");
  $("#modal").innerHTML = `
    <div class="modal-head"><h2>Link a file</h2>
      <button class="btn ghost sm" data-action="close-modal">✕ close</button></div>
    ${crumbs}
    <div class="modal-body">${dirItems}${fileItems ||
      `<div class="empty-note">No files in this folder.</div>`}</div>`;
}

/* ---------- mutations via event delegation ---------- */
function addAnd(cid, listName, item) {
  const c = course(cid);
  c[listName] = c[listName] || [];
  c[listName].push(item);
  save(); route();
}

document.addEventListener("click", async e => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const { action, cid, id, path, target } = el.dataset;

  switch (action) {
    case "toggle-chip":
      EXPANDED_CHIP = (cid && EXPANDED_CHIP !== cid) ? cid : null;
      refreshTiers(); return;
    case "set-tier": {
      const t = el.dataset.tier;
      setTier(cid, t === "" ? null : Number(t), undefined);
      return;
    }
    case "goto-course":
      location.hash = "#course/" + cid; return;
    case "clear-tiers":
      if (!confirm("Clear the tier for every course? The courses themselves are untouched.")) return;
      DATA.courses.forEach(c => { delete c.tier; delete c.tierPos; });
      EXPANDED_CHIP = null;
      save(); refreshTiers(); return;
    case "clear-filters":
      FILTERS.q = ""; FILTERS.country = ""; FILTERS.status = "";
      route(); break;
    case "open-course":
      if (e.target.closest("input,select,button,a")) return;
      location.hash = "#course/" + cid; break;
    case "add-course": {
      const nc = {
        id: uid(), university: "", programme: "", location: "", portalUrl: "",
        status: "researching", deadlines: [], fees: { application: "", tuition: "" },
        scholarships: [], requirements: [], links: [], docs: [
          { id: uid(), name: "Motivation letter", status: "missing", path: "" },
        ],
        sharedDocIds: DATA.sharedDocs.map(d => d.id),
        contacts: [], log: [], notes: "",
      };
      DATA.courses.push(nc); save();
      location.hash = "#course/" + nc.id; break;
    }
    case "del-course":
      if (confirm("Delete this course and everything tracked under it?")) {
        DATA.courses = DATA.courses.filter(x => x.id !== cid);
        save(); location.hash = "";
      } break;
    case "open-file": openFile(path); break;
    case "pick-file": {
      const setPath = p => {
        if (target === "shareddoc") sharedDoc(id).path = p;
        else { const d = course(cid).docs.find(x => x.id === id); d.path = p; if (d.status === "missing") d.status = "draft"; }
        save(); closePicker(); route();
      };
      openPicker("", setPath); break;
    }
    case "choose-file": pickerCallback && pickerCallback(path); break;
    case "browse": browseTo(path); break;
    case "close-modal": closePicker(); break;

    case "add-doc": addAnd(cid, "docs", { id: uid(), name: "", status: "missing", path: "" }); break;
    case "del-doc": course(cid).docs = course(cid).docs.filter(x => x.id !== id); save(); route(); break;
    case "toggle-shared": {
      const c = course(cid); c.sharedDocIds = c.sharedDocIds || [];
      c.sharedDocIds = el.checked ? c.sharedDocIds.concat(id)
        : c.sharedDocIds.filter(x => x !== id);
      save(); route(); break;
    }
    case "add-req": addAnd(cid, "requirements", { id: uid(), label: "", required: "", metricId: "", manual: "unknown" }); break;
    case "del-req": course(cid).requirements = course(cid).requirements.filter(x => x.id !== id); save(); route(); break;
    case "cycle-met": {
      const r = course(cid).requirements.find(x => x.id === id);
      r.manual = r.manual === "unknown" ? "met" : r.manual === "met" ? "notmet" : "unknown";
      save(); route(); break;
    }
    case "add-deadline": addAnd(cid, "deadlines", { id: uid(), label: "", date: "" }); break;
    case "del-deadline": course(cid).deadlines = course(cid).deadlines.filter(x => x.id !== id); save(); route(); break;
    case "add-sch": addAnd(cid, "scholarships", { id: uid(), name: "", amount: "", deadline: "", status: "exploring" }); break;
    case "del-sch": course(cid).scholarships = course(cid).scholarships.filter(x => x.id !== id); save(); route(); break;
    case "add-link": addAnd(cid, "links", { id: uid(), label: "", url: "" }); break;
    case "del-link":
      course(cid).links = (course(cid).links || []).filter(x => x.id !== id);
      save(); route(); break;
    case "paste-links": {
      const ta = $("#linkPaste");
      const found = parseLinkLines(ta ? ta.value : "");
      const tc = course(cid);
      tc.links = tc.links || [];
      const have = new Set(tc.links.map(l => (l.url || "").trim()));
      const fresh = found.filter(l => !have.has(l.url));
      if (!fresh.length) {
        alert(found.length
          ? "Those links are already on this course."
          : "No links found — each line needs an http:// or https:// address.");
        return;
      }
      tc.links.push(...fresh);
      save(); route();
      break;
    }
    case "add-contact": addAnd(cid, "contacts", { id: uid(), name: "", role: "", email: "" }); break;
    case "del-contact": course(cid).contacts = course(cid).contacts.filter(x => x.id !== id); save(); route(); break;
    case "add-log": addAnd(cid, "log", { id: uid(), date: todayISO(), text: "" }); break;
    case "del-log": course(cid).log = course(cid).log.filter(x => x.id !== id); save(); route(); break;

    case "add-referee":
      DATA.profile.referees = DATA.profile.referees || [];
      DATA.profile.referees.push({ id: uid(), name: "", role: "", email: "", status: "tocontact", note: "" });
      save(); route(); break;
    case "del-referee":
      DATA.profile.referees = DATA.profile.referees.filter(x => x.id !== id);
      save(); route(); break;
    case "add-metric": DATA.profile.metrics.push({ id: uid(), label: "", value: "" }); save(); route(); break;
    case "del-metric": DATA.profile.metrics = DATA.profile.metrics.filter(x => x.id !== id); save(); route(); break;
    case "add-shareddoc": DATA.sharedDocs.push({ id: uid(), name: "", status: "missing", path: "" }); save(); route(); break;
    case "del-shareddoc":
      if (confirm("Remove this shared document from all courses?")) {
        DATA.sharedDocs = DATA.sharedDocs.filter(x => x.id !== id);
        DATA.courses.forEach(c => c.sharedDocIds = (c.sharedDocIds || []).filter(x => x !== id));
        save(); route();
      } break;
  }
});

/* edits: text inputs save quietly; selects/dates/checkbox-adjacent re-render */
function applyEdit(el) {
  const [entity, field] = el.dataset.edit.split(":");
  const { cid, id } = el.dataset;
  const v = el.value;
  const c = cid ? course(cid) : null;
  const setDeep = (obj, dotted, val) => {
    const parts = dotted.split(".");
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] = o[parts[i]] || {};
    o[parts[parts.length - 1]] = val;
  };
  switch (entity) {
    case "course": setDeep(c, field, v); break;
    case "doc": setDeep(c.docs.find(x => x.id === id), field, v); break;
    case "req": setDeep(c.requirements.find(x => x.id === id), field, v); break;
    case "deadline": setDeep(c.deadlines.find(x => x.id === id), field, v); break;
    case "sch": setDeep(c.scholarships.find(x => x.id === id), field, v); break;
    case "link": setDeep((c.links || []).find(x => x.id === id), field, v); break;
    case "contact": setDeep(c.contacts.find(x => x.id === id), field, v); break;
    case "log": setDeep(c.log.find(x => x.id === id), field, v); break;
    case "metric": setDeep(metricById(id), field, v); break;
    case "referee": setDeep(DATA.profile.referees.find(x => x.id === id), field, v); break;
    case "shareddoc": setDeep(sharedDoc(id), field, v); break;
    case "profile": setDeep(DATA.profile, field, v); break;
  }
  save();
}
document.addEventListener("input", e => {
  const el = e.target;
  if (!el.dataset.edit) return;
  if (el.tagName === "SELECT" || el.type === "date") return; // handled on change
  applyEdit(el);
});
document.addEventListener("change", e => {
  const el = e.target;
  if (!el.dataset.edit) return;
  if (el.tagName === "SELECT" || el.type === "date") { applyEdit(el); route(); }
});

/* ---------- filter controls ---------- */
function onFilterChange(el) {
  FILTERS[el.dataset.filter] = el.value;
  if (location.hash === "#timeline") renderTimeline();
  else refreshOverview();
}
document.addEventListener("input", e => {
  if (!e.target.dataset.filter || e.target.tagName === "SELECT") return;
  onFilterChange(e.target);
});
document.addEventListener("change", e => {
  if (!e.target.dataset.filter) return;
  onFilterChange(e.target);
});

window.addEventListener("hashchange", route);

fetch("/api/data").then(r => r.json()).then(d => { DATA = d; route(); });
