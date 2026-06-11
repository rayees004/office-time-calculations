// ============================================================
//  LapTime AOC — Live Google Sheets Sync
//  3-tier fetch: CSV → GViz JSONP (file:// safe) → Proxy
// ============================================================

const SHEET_ID  = '1hDBU2OmyoNudLT-ChW2nYsfezN530hOmkp6-z-qOaIQ';
const GID       = '1973996240';

// Tier 1 — Published CSV (fastest, works on HTTP servers)
const CSV_URL   = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ1e3N1jcTMuVlyewDlyf9XsmpNQKMDs-NOAv-d5WUICY_jJ1ZYUjilESVv8j0egiJcETwWM3hZDnMn/pub?gid=1973996240&single=true&output=csv';

// Tier 2 — Google Visualization API JSONP (works from file://, no CORS ever)
const GVIZ_BASE = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?gid=${GID}&headers=1`;

// Tier 3 — allorigins proxy fallback
const PROXY_URL = `https://api.allorigins.win/raw?url=${encodeURIComponent(CSV_URL)}`;

// Auto-refresh every 30 seconds
const REFRESH_MS = 30_000;

// ── Time slot definitions (column indices in sheet) ────────
const TIME_SLOTS = [
  { label: '8:00 – 10:00',  short: '8 AM',  badge: 's1', colIdx: 1 },
  { label: '10:00 – 12:00', short: '10 AM', badge: 's2', colIdx: 2 },
  { label: '12:00 – 2:00',  short: '12 PM', badge: 's3', colIdx: 3 },
  { label: '2:00 – 4:00',   short: '2 PM',  badge: 's4', colIdx: 4 },
  { label: '4:00 – 6:00',   short: '4 PM',  badge: 's5', colIdx: 5 },
];

// ── Subject metadata (keyed by UPPERCASE name from sheet) ──
const SUBJECTS_META = {
  DM:        { full: 'Digital Marketing', display: 'DM',        emoji: '📊', color: '#6366f1' },
  GD:        { full: 'Graphic Design',    display: 'GD',        emoji: '🎨', color: '#10b981' },
  DS:        { full: 'Data Science',      display: 'Ds',        emoji: '📈', color: '#f59e0b' },
  DJANGO:    { full: 'Django (Web Dev)',  display: 'Django',    emoji: '🌐', color: '#ec4899' },
  TALLY:     { full: 'Tally (Accounts)', display: 'Tally',     emoji: '🧾', color: '#06b6d4' },
  HR:        { full: 'Human Resources',  display: 'HR',        emoji: '👥', color: '#8b5cf6' },
  LOGISTICS: { full: 'Logistics',        display: 'LOGISTICS', emoji: '🚚', color: '#f97316' },
  MERN:      { full: 'MERN Stack',       display: 'MERN',      emoji: '🖥️', color: '#14b8a6' },
};

// ── Global state ───────────────────────────────────────────
let scheduleData   = [];
let refreshTimer   = null;
let countdownTimer = null;
let nextRefreshAt  = null;
let knownSubjects  = {};

// ── Filter state ───────────────────────────────────────────
let filterSearch  = '';
let filterSubject = 'all';
let filterSlot    = 'all';

// ============================================================
//  NORMALISE subject value from sheet cell
// ============================================================
function normaliseSubject(raw) {
  if (raw == null) return '-';
  const s = String(raw).replace(/[\r\n\t]+/g, '').trim();
  return (!s || s === '-') ? '-' : s.toUpperCase();
}

// ============================================================
//  CSV PARSING
// ============================================================
function parseCSV(csv) {
  const rows = [];
  for (const line of csv.split('\n')) {
    if (!line.trim()) continue;
    const cols = [];
    let inQ = false, cell = '';
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cell.trim()); cell = ''; }
      else { cell += ch; }
    }
    cols.push(cell.trim());
    rows.push(cols);
  }
  return rows;
}

function buildFromCSVRows(rows) {
  // row[0] = header, row[1+] = data
  const data = [];
  for (let r = 1; r < rows.length; r++) {
    const row    = rows[r];
    const lapRaw = (row[0] || '').replace(/\D/g, '');
    if (!lapRaw) continue;
    const lap = parseInt(lapRaw, 10);
    if (isNaN(lap) || lap <= 0) continue;
    const slots = TIME_SLOTS.map(ts => normaliseSubject(row[ts.colIdx] || ''));
    data.push({ lap, slots });
  }
  return data;
}

// ============================================================
//  GVIZ JSON PARSING
// ============================================================
function buildFromGVizTable(table) {
  const data = [];
  (table.rows || []).forEach(row => {
    const cells   = row.c || [];
    const lapCell = cells[0];
    if (!lapCell || lapCell.v == null) return;
    const lap = Math.round(Number(lapCell.v));
    if (!lap || lap <= 0) return;
    const slots = TIME_SLOTS.map(ts => {
      const c = cells[ts.colIdx];
      return normaliseSubject(c?.v != null ? String(c.v) : '');
    });
    data.push({ lap, slots });
  });
  return data;
}

// ============================================================
//  TIER 2 — JSONP GViz fetch (works from file://)
// ============================================================
function fetchGVizJSONP() {
  return new Promise((resolve, reject) => {
    const cbName = '__laptime_' + Date.now();
    const script = document.createElement('script');
    const timer  = setTimeout(() => { cleanup(); reject(new Error('GViz JSONP timeout')); }, 12000);

    function cleanup() {
      clearTimeout(timer);
      delete window[cbName];
      script.parentNode?.removeChild(script);
    }

    window[cbName] = function(resp) {
      cleanup();
      if (resp?.table) resolve(resp.table);
      else reject(new Error('GViz: no table in response'));
    };

    script.onerror = () => { cleanup(); reject(new Error('GViz script load failed')); };
    script.src = `${GVIZ_BASE}&tqx=out:json;responseHandler:${cbName}&t=${Date.now()}`;
    document.head.appendChild(script);
  });
}

// ============================================================
//  MAIN FETCH — tries all 3 tiers automatically
// ============================================================
async function fetchSheetData() {
  setSyncState('syncing');
  let newData = null;
  let method  = '';

  // ── Tier 1: published CSV ──────────────────────────────
  try {
    const res = await fetch(`${CSV_URL}&cb=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const csv = await res.text();
    if (!csv || csv.length < 10) throw new Error('Empty response');
    newData = buildFromCSVRows(parseCSV(csv));
    method  = 'Google Sheets CSV';
  } catch (e1) {
    console.warn('[LapTime] Tier 1 (CSV) failed:', e1.message);

    // ── Tier 2: GViz JSONP (file:// safe, no CORS) ────────
    try {
      const table = await fetchGVizJSONP();
      newData = buildFromGVizTable(table);
      method  = 'GViz API';
    } catch (e2) {
      console.warn('[LapTime] Tier 2 (GViz) failed:', e2.message);

      // ── Tier 3: allorigins proxy ───────────────────────
      try {
        const res = await fetch(`${PROXY_URL}&cb=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
        const csv = await res.text();
        newData = buildFromCSVRows(parseCSV(csv));
        method  = 'proxy';
      } catch (e3) {
        console.error('[LapTime] All 3 tiers failed:', e3.message);
        setSyncState('error', false,
          'Cannot reach Google Sheets. Please check your internet connection and try again.');
        return;
      }
    }
  }

  if (!newData || newData.length === 0) {
    setSyncState('error', false, 'Sheet returned no rows. Check the spreadsheet has data.');
    return;
  }

  const changed = JSON.stringify(newData) !== JSON.stringify(scheduleData);
  scheduleData  = newData;
  console.log(`[LapTime] ✅ Loaded ${newData.length} rows via ${method}`, changed ? '(DATA CHANGED)' : '(no change)');

  discoverSubjects();
  buildLegend();
  buildTable();
  updateStats();
  buildSummaryCards();
  rebuildSubjectFilter();
  applyFilters();
  highlightCurrentSlot();
  refreshFreeChecker();        // ← update free checker counts & results
  setSyncState('ok', changed, method);
}

// ============================================================
//  AUTO-REFRESH SCHEDULER
// ============================================================
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  clearInterval(countdownTimer);
  nextRefreshAt = Date.now() + REFRESH_MS;

  countdownTimer = setInterval(() => {
    const sec = Math.max(0, Math.round((nextRefreshAt - Date.now()) / 1000));
    const el  = document.getElementById('syncBarTime');
    if (el) el.textContent = `Next sync in ${sec}s`;
  }, 1000);

  refreshTimer = setTimeout(async () => {
    clearInterval(countdownTimer);
    await fetchSheetData();
    scheduleRefresh();
  }, REFRESH_MS);
}

// ============================================================
//  SYNC STATE UI
// ============================================================
function setSyncState(state, changed = false, extra = '') {
  const $id = id => document.getElementById(id);
  const bar     = $id('syncBar');
  const icon    = $id('syncBarIcon');
  const msg     = $id('syncBarMsg');
  const timeEl  = $id('syncBarTime');
  const dot     = $id('syncDot');
  const label   = $id('syncLabel');
  const overlay = $id('tableOverlay');
  const errOv   = $id('errorOverlay');
  const badge   = $id('syncBadge');
  if (!bar) return;

  bar.className = 'sync-bar';

  if (state === 'syncing') {
    bar.classList.add('sync-syncing');
    if (icon)  icon.textContent  = '⏳';
    if (msg)   msg.textContent   = 'Connecting to Google Sheets…';
    if (timeEl) timeEl.textContent = '';
    if (dot)   dot.style.background = '#f59e0b';
    if (label) label.textContent = 'Syncing…';
    if (overlay) overlay.style.display = scheduleData.length === 0 ? 'flex' : 'none';
    if (errOv)   errOv.style.display   = 'none';

  } else if (state === 'ok') {
    bar.classList.add('sync-ok');
    const t = new Date().toLocaleTimeString('en-IN',
      { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (icon)  icon.textContent  = changed ? '🔄' : '✅';
    if (msg)   msg.textContent   = changed
      ? `⚡ Spreadsheet updated! Refreshed at ${t}`
      : `✅ Synced at ${t} via ${extra}`;
    if (dot)   dot.style.background   = '#10b981';
    if (label) label.textContent      = 'Live';
    if (overlay) overlay.style.display = 'none';
    if (errOv)   errOv.style.display   = 'none';
    if (badge)   badge.style.borderColor = 'rgba(16,185,129,0.4)';

  } else if (state === 'error') {
    bar.classList.add('sync-error');
    if (icon)  icon.textContent  = '⚠️';
    if (msg)   msg.textContent   = extra || 'Could not load sheet data';
    if (timeEl) timeEl.textContent = '';
    if (dot)   dot.style.background   = '#f43f5e';
    if (label) label.textContent      = 'Error';
    if (overlay) overlay.style.display = 'none';
    if (errOv && scheduleData.length === 0) {
      errOv.style.display = 'flex';
      const em = document.getElementById('errorMsg');
      if (em)  em.innerHTML = extra || 'Could not fetch data.';
    }
    if (badge) badge.style.borderColor = 'rgba(244,63,94,0.4)';
  }
}

// ============================================================
//  SUBJECT DISCOVERY (dynamic from sheet data)
// ============================================================
function discoverSubjects() {
  knownSubjects = {};
  scheduleData.forEach(row => {
    row.slots.forEach(s => {
      if (s && s !== '-' && !knownSubjects[s]) {
        const meta = SUBJECTS_META[s] || {
          full: s, display: s, emoji: '📁',
          color: `hsl(${Math.abs(hashStr(s)) % 360},65%,58%)`
        };
        knownSubjects[s] = { ...meta, key: s };
      }
    });
  });
}

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
}

// ============================================================
//  BUILD LEGEND
// ============================================================
function buildLegend() {
  const c = document.getElementById('legendItems');
  if (!c) return;
  c.innerHTML = '';
  Object.values(knownSubjects).forEach(sub => {
    const el = document.createElement('div');
    el.className  = 'legend-item';
    el.style.cssText =
      `background:${sub.color}20;border:1px solid ${sub.color}50;color:${sub.color}`;
    el.innerHTML = `
      <span class="legend-dot" style="background:${sub.color}"></span>
      <span>${sub.emoji} ${sub.display || sub.key}</span>
      <span style="opacity:.7;font-size:.7rem"> – ${sub.full}</span>`;
    c.appendChild(el);
  });
  const free = document.createElement('div');
  free.className  = 'legend-item';
  free.style.cssText = 'background:rgba(30,41,59,.6);border:1px solid rgba(255,255,255,.1);color:#475569';
  free.innerHTML = `<span class="legend-dot" style="background:#334155"></span>
    <span>— Free / Available</span>`;
  c.appendChild(free);
}

// ============================================================
//  REBUILD SUBJECT FILTER (dynamically from live data)
// ============================================================
function rebuildSubjectFilter() {
  const sel = document.getElementById('subjectFilter');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="all">All Subjects</option>';
  Object.values(knownSubjects).forEach(sub => {
    const o = document.createElement('option');
    o.value = sub.key;
    o.textContent = `${sub.emoji} ${sub.display || sub.key} – ${sub.full}`;
    sel.appendChild(o);
  });
  const fo = document.createElement('option');
  fo.value = '-'; fo.textContent = '⬜ Free / Available';
  sel.appendChild(fo);
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}

// ============================================================
//  SLOT CELL HTML
// ============================================================
function getSlotCell(subject) {
  if (!subject || subject === '-')
    return `<span class="slot-cell free">— free</span>`;
  const sub   = knownSubjects[subject] || {};
  const color = sub.color   || '#6366f1';
  const emoji = sub.emoji   || '📁';
  const label = sub.display || subject;
  const full  = sub.full    || subject;
  return `<span class="slot-cell booked" title="${full}"
    style="background:${color}20;border:1px solid ${color}55;color:${color}">
    ${emoji} ${label}</span>`;
}

// ============================================================
//  BUILD TABLE
// ============================================================
function buildTable() {
  const tbody = document.getElementById('tableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  scheduleData.forEach((row, i) => {
    const tr = document.createElement('tr');
    tr.dataset.lap      = row.lap;
    tr.dataset.subjects = row.slots.map(s => s.toLowerCase()).join(',');
    tr.style.animationDelay = `${i * 0.03}s`;
    tr.classList.add('fade-in');
    tr.innerHTML =
      `<td class="lap-cell"><span class="lap-number">${row.lap}</span></td>` +
      row.slots.map(s => `<td>${getSlotCell(s)}</td>`).join('');
    tbody.appendChild(tr);
  });
}

// ============================================================
//  STATS (animated counters)
// ============================================================
function updateStats() {
  let booked = 0;
  scheduleData.forEach(r => r.slots.forEach(s => { if (s !== '-') booked++; }));
  animateCount('bookedSlots',   0, booked,                          800);
  animateCount('totalLaps',     0, scheduleData.length,             600);
  animateCount('totalSubjects', 0, Object.keys(knownSubjects).length, 700);
}

function animateCount(id, from, to, dur) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = performance.now();
  const step = now => {
    const p = Math.min((now - start) / dur, 1);
    el.textContent = Math.round(from + (to - from) * (1 - (1 - p) ** 3));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ============================================================
//  SUMMARY CARDS
// ============================================================
function buildSummaryCards() {
  const grid = document.getElementById('summaryGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const counts = {};
  scheduleData.forEach(r =>
    r.slots.forEach(s => { if (s !== '-') counts[s] = (counts[s] || 0) + 1; }));
  const max = Math.max(1, ...Object.values(counts));

  Object.entries(knownSubjects).forEach(([key, sub]) => {
    const count = counts[key] || 0;
    const pct   = Math.round(count / max * 100);
    const card  = document.createElement('div');
    card.className = 'summary-card';
    card.innerHTML = `
      <div class="summary-top-bar" style="background:${sub.color};box-shadow:0 0 10px ${sub.color}88"></div>
      <div class="summary-emoji">${sub.emoji}</div>
      <div class="summary-name">${sub.display || sub.key}</div>
      <div class="summary-full">${sub.full}</div>
      <div class="summary-count" style="color:${sub.color}">${count}</div>
      <div class="summary-slots-label">total slots</div>
      <div class="summary-bar">
        <div class="summary-bar-fill" data-width="${pct}"
          style="background:${sub.color};width:0%"></div>
      </div>`;
    grid.appendChild(card);
  });

  setTimeout(() =>
    document.querySelectorAll('.summary-bar-fill')
      .forEach(b => b.style.width = b.dataset.width + '%'), 350);
}

// ============================================================
//  ACTIVE TIME SLOT HIGHLIGHT
// ============================================================
function highlightCurrentSlot() {
  const h     = new Date().getHours();
  const hours = [[8,10],[10,12],[12,14],[14,16],[16,18]];
  document.querySelectorAll('thead th').forEach((th, i) => {
    th.style.background   = '';
    th.style.borderBottom = '';
    if (i > 0) {
      const [s, e] = hours[i - 1];
      if (h >= s && h < e) {
        th.style.background   = 'rgba(99,102,241,0.14)';
        th.style.borderBottom = '2px solid rgba(99,102,241,0.7)';
      }
    }
  });
}

// ============================================================
//  FILTER & SEARCH
// ============================================================
function applyFilters() {
  let visible = 0;
  document.querySelectorAll('#tableBody tr').forEach(row => {
    const lap      = row.dataset.lap || '';
    const subjects = (row.dataset.subjects || '').split(',');
    let show = true;

    if (filterSearch) {
      const q = filterSearch.toLowerCase();
      show = lap.includes(q) || subjects.some(s => s.includes(q));
    }
    if (show && filterSubject !== 'all') {
      const t = filterSubject.toLowerCase();
      show = t === '-' ? subjects.includes('-') : subjects.includes(t);
    }
    if (show && filterSlot !== 'all') {
      const idx = parseInt(filterSlot);
      const v   = subjects[idx];
      if (filterSubject !== 'all') {
        const t = filterSubject.toLowerCase();
        show = t === '-' ? v === '-' : v === t;
      }
    }

    row.classList.toggle('hidden-row', !show);
    if (show) visible++;
  });

  const el = document.getElementById('resultsCount');
  if (el) el.textContent = visible === scheduleData.length
    ? `Showing all ${scheduleData.length} laptops`
    : `Showing ${visible} of ${scheduleData.length} laptops`;
}

// ============================================================
//  LIVE CLOCK
// ============================================================
function updateClock() {
  const el = document.getElementById('currentTime');
  if (!el) return;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  el.textContent = `${hh}:${mm}:${ss}`;
  if (ss === '00') highlightCurrentSlot();
}

// ============================================================
//  INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  setInterval(updateClock, 1000);
  updateClock();

  const $  = id => document.getElementById(id);
  const on = (id, ev, fn) => $(id)?.addEventListener(ev, fn);

  on('searchInput',   'input',  e => { filterSearch  = e.target.value.trim(); applyFilters(); });
  on('subjectFilter', 'change', e => { filterSubject = e.target.value;        applyFilters(); });
  on('slotFilter',    'change', e => { filterSlot    = e.target.value;        applyFilters(); });

  on('resetBtn', 'click', () => {
    $('searchInput').value      = '';
    $('subjectFilter').value    = 'all';
    $('slotFilter').value       = 'all';
    filterSearch = ''; filterSubject = 'all'; filterSlot = 'all';
    applyFilters();
  });

  on('refreshBtn', 'click', async () => {
    clearTimeout(refreshTimer);
    clearInterval(countdownTimer);
    await fetchSheetData();
    scheduleRefresh();
  });

  on('retryBtn', 'click', async () => {
    await fetchSheetData();
    scheduleRefresh();
  });

  // Initial load
  await fetchSheetData();
  scheduleRefresh();
});

// ============================================================
//  FREE LAPTOP CHECKER
// ============================================================

let activeSlotIdx = null;  // which slot button is selected

// Called after data loads (or reloads) to refresh checker UI
function refreshFreeChecker() {
  updateSlotButtonCounts();
  updateCurrentSlotIndicator();
  // Re-render results if a slot was already selected
  if (activeSlotIdx !== null) renderFreeResults(activeSlotIdx);
}

// ── Update the free count on each slot button ─────────────
function updateSlotButtonCounts() {
  TIME_SLOTS.forEach((ts, idx) => {
    const freeCount = scheduleData.filter(row => row.slots[idx] === '-').length;
    const el = document.getElementById(`freeCount${idx}`);
    if (el) el.textContent = freeCount;
  });
}

// ── Mark the currently active time slot with "NOW" ────────
function updateCurrentSlotIndicator() {
  const h = new Date().getHours();
  const slotHours = [[8,10],[10,12],[12,14],[14,16],[16,18]];
  const labelEl   = document.getElementById('currentSlotLabel');
  let   nowIdx    = -1;

  slotHours.forEach(([s, e], idx) => {
    const btn = document.getElementById(`slotBtn${idx}`);
    if (!btn) return;
    btn.classList.toggle('is-now', h >= s && h < e);
    if (h >= s && h < e) nowIdx = idx;
  });

  if (labelEl) {
    if (nowIdx >= 0) {
      labelEl.textContent = `Now: ${TIME_SLOTS[nowIdx].label}`;
    } else {
      const isBeforeSchool = h < 8;
      const isAfterSchool  = h >= 18;
      labelEl.textContent  = isBeforeSchool ? 'School not started' :
                             isAfterSchool  ? 'All slots finished' :
                                             'Outside slot hours';
    }
  }
}

// ── Render free + booked grids for a given slot ───────────
function renderFreeResults(slotIdx) {
  const ts         = TIME_SLOTS[slotIdx];
  const freeGrid   = document.getElementById('freeLaptopGrid');
  const bookedGrid = document.getElementById('bookedLaptopGrid');
  const slotLabel  = document.getElementById('freeResultsSlotLabel');
  const summary    = document.getElementById('freeResultsSummary');
  const pillFree   = document.getElementById('pillFreeNum');
  const pillBooked = document.getElementById('pillBookedNum');
  const bar        = document.getElementById('availabilityBar');

  if (!freeGrid || !bookedGrid) return;

  const freeLaps   = [];
  const bookedLaps = [];

  scheduleData.forEach(row => {
    const val = row.slots[slotIdx];
    if (val === '-') freeLaps.push({ lap: row.lap, subject: null });
    else             bookedLaps.push({ lap: row.lap, subject: val });
  });

  const total    = freeLaps.length + bookedLaps.length;
  const freePct  = total > 0 ? Math.round((freeLaps.length / total) * 100) : 0;

  // Header
  if (slotLabel) slotLabel.textContent = `⏰ ${ts.label}`;
  if (summary)   summary.textContent   =
    `${freeLaps.length} of ${total} laptops available`;

  // Pills
  if (pillFree)   pillFree.textContent   = freeLaps.length;
  if (pillBooked) pillBooked.textContent = bookedLaps.length;

  // Availability bar
  if (bar) {
    bar.style.width = '0%';
    setTimeout(() => { bar.style.width = freePct + '%'; }, 50);
  }

  // Render FREE grid
  freeGrid.innerHTML = '';
  if (freeLaps.length === 0) {
    freeGrid.innerHTML = '<div class="lc-empty">No free laptops in this slot</div>';
  } else {
    freeLaps.forEach((item, i) => {
      const card = document.createElement('div');
      card.className = 'lc-card lc-free';
      card.style.animationDelay = `${i * 0.04}s`;
      card.title = `Laptop ${item.lap} — Free`;
      card.innerHTML = `${item.lap}<span class="lc-subject">FREE</span>`;
      freeGrid.appendChild(card);
    });
  }

  // Render BOOKED grid
  bookedGrid.innerHTML = '';
  if (bookedLaps.length === 0) {
    bookedGrid.innerHTML = '<div class="lc-empty">All laptops are free!</div>';
  } else {
    bookedLaps.forEach((item, i) => {
      const sub   = knownSubjects[item.subject] || {};
      const color = sub.color   || '#6366f1';
      const label = sub.display || item.subject;
      const card  = document.createElement('div');
      card.className = 'lc-card lc-booked';
      card.style.animationDelay = `${i * 0.04}s`;
      card.style.borderColor = color + '40';
      card.style.color = color;
      card.title = `Laptop ${item.lap} — ${sub.full || item.subject}`;
      card.innerHTML = `${item.lap}<span class="lc-subject">${label}</span>`;
      bookedGrid.appendChild(card);
    });
  }
}

// ── Wire up slot buttons ───────────────────────────────────
(function initFreeChecker() {
  document.addEventListener('DOMContentLoaded', () => {
    TIME_SLOTS.forEach((ts, idx) => {
      const btn = document.getElementById(`slotBtn${idx}`);
      if (!btn) return;
      btn.addEventListener('click', () => {
        // Toggle active
        document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeSlotIdx = idx;
        renderFreeResults(idx);

        // Smooth scroll to results on mobile
        const panel = document.getElementById('freeResultsPanel');
        if (panel && window.innerWidth < 700) {
          panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  });
})();

// Hook into data refresh — update checker whenever data reloads
const _origBuildTable = buildTable;
// (refreshFreeChecker is called manually at end of fetchSheetData pipeline)
