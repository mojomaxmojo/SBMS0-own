/* SBMS0 HISTORIE – 30 Tage Default, Zeitraum frei wählbar */
'use strict';

/* ---------- Zeitraum-Verwaltung ---------- */
let range = { startMs: 0, endMs: 0, hours: 720 }; // Default 30 Tage

function setRangeHours(h) {
  range.hours = h;
  range.endMs = Date.now();
  range.startMs = range.endMs - h * 3600 * 1000;
  onRangeChanged();
}

function setRangeCustom(fromDateStr, toDateStr) {
  const from = fromDateStr ? new Date(fromDateStr + 'T00:00:00') : new Date(Date.now() - 30 * 86400e3);
  const to = toDateStr ? new Date(toDateStr + 'T23:59:59') : new Date();
  range.startMs = from.getTime();
  range.endMs = Math.max(to.getTime(), from.getTime() + 3600e3);
  range.hours = (range.endMs - range.startMs) / 3600e3;
  onRangeChanged();
}

// Gruppierungs-Intervall: Ziel ~1500 Punkte (wie Grafana $__interval)
function groupIntervalMin() {
  const min = (range.endMs - range.startMs) / 60000;
  return Math.max(1, Math.round(min / 1500));
}

// Nanosekunden-Integer (InfluxQL-sicher; ms-Literale koennen ignoriert werden)
const TF = () => `time > ${Math.round(range.startMs * 1e6)} AND time <= ${Math.round(range.endMs * 1e6)}`;

/* ---------- Queries ---------- */
const Q_BAT = (ivl) =>
  `SELECT mean("Battery Voltage") AS volt, mean("State of Charge") AS soc ` +
  `FROM "downsampled_1m"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND ${TF()} GROUP BY time(${ivl}m) fill(null)`;

const Q_FLOW = (ivl) =>
  `SELECT mean("PV Power W") AS pv, mean("Consumption Power W") AS cons, mean("Battery Power W") AS bat ` +
  `FROM "downsampled_1m"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND ${TF()} GROUP BY time(${ivl}m) fill(null)`;

// Stats als Funktionen – Template-Literale würden den Zeitraum beim Script-Start einfrieren!
const Q_PV_KWH = () => `SELECT sum("PV Power W") / 3600 / 1000 AS v FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND ${TF()}`;
const Q_LOAD_KWH = () => `SELECT sum("Consumption Power W") / 3600 / 1000 AS v FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND ${TF()}`;
const Q_CELLMINS = () => `SELECT min("Cell 1") AS c1, min("Cell 2") AS c2, min("Cell 3") AS c3, min("Cell 4") AS c4, min("Cell 5") AS c5, min("Cell 6") AS c6, min("Cell 7") AS c7, min("Cell 8") AS c8 FROM "downsampled_1m"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND ${TF()}`;
const Q_DELTA = () => `SELECT min("Cell Delta") * 1000 AS v FROM "downsampled_1m"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND ${TF()}`;

/* ---------- UI: Zeitraum-Leiste ---------- */
document.querySelectorAll('.range-btns button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.range-btns button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    $('from-date').value = ''; $('to-date').value = '';
    setRangeHours(parseInt(b.dataset.h));
  });
});
$('apply-custom').addEventListener('click', () => {
  document.querySelectorAll('.range-btns button').forEach((x) => x.classList.remove('active'));
  setRangeCustom($('from-date').value, $('to-date').value);
});

function rangeInfoText() {
  const d1 = new Date(range.startMs).toLocaleDateString('de-DE');
  const d2 = new Date(range.endMs).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const days = (range.hours / 24).toFixed(1);
  return `${d1} – ${d2} (${days} Tage, Auflösung ${groupIntervalMin()} min)`;
}

/* ---------- Charts ---------- */
function fmtW(v) {
  if (v == null) return '–';
  const a = Math.abs(v);
  if (a >= 1000) return (v / 1000).toFixed(1) + ' kW';
  return v.toFixed(0) + ' W';
}

let battPlot = null, flowPlot = null;

async function updateBatt() {
  const s = await fetchSeries(Q_BAT(groupIntervalMin()));
  if (!s) return;
  const data = [[], [], []];
  for (const v of s.values) {
    data[0].push(v[0]);
    data[1].push(v[1] == null ? null : Number(v[1]));
    data[2].push(v[2] == null ? null : Number(v[2]));
  }
  const opts = uplotBaseOpts(300, (u, vals) => vals.map((v) => Number(v).toFixed(2) + ' V'));
  opts.width = $('battchart').clientWidth;
  opts.legend = { show: true, live: true };
  opts.cursor = { x: true, y: false, points: { show: false } };
  opts.series = [
    {},
    { label: 'Voltage', stroke: '#5794f2', width: 2, spanGaps: true, scale: 'volt', fill: 'rgba(87,148,242,0.12)' },
    { label: 'SOC', stroke: '#73bf69', width: 2, spanGaps: true, scale: 'soc',
      points: { show: false }, fill: 'rgba(115,191,105,0.18)' },
  ];
  opts.scales = { x: { time: true },
    volt: { auto: true, range: (u, a, b) => [Math.floor(a), Math.ceil(b)] },
    soc: { auto: true, range: [0, 100] } };
  opts.axes = [
    { stroke: '#8e8e8e', grid: { stroke: '#2c3235' }, ticks: { stroke: '#2c3235' },
      values: (u, vals) => vals.map((v) => fmtAxisDate(v)) },
    { scale: 'volt', stroke: '#5794f2', grid: { stroke: '#2c3235' }, ticks: { stroke: '#2c3235' }, side: 3, size: 70,
      values: (u, vals) => vals.map((v) => Number(v).toFixed(2) + ' V') },
    { scale: 'soc', stroke: '#73bf69', grid: { show: false }, ticks: { stroke: '#2c3235' }, side: 1, size: 60,
      values: (u, vals) => vals.map((v) => Number(v).toFixed(0) + ' %') },
  ];
  if (!battPlot) battPlot = new uPlot(opts, data, $('battchart'));
  else { battPlot.scales = opts.scales; battPlot.setData(data, true); }
  renderLegendTable($('battlegend'), [
    { label: 'Voltage', color: '#5794f2', values: data[1], fmt: (v) => v == null ? '–' : v.toFixed(2) + ' V' },
    { label: 'SOC', color: '#73bf69', values: data[2], fmt: (v) => v == null ? '–' : v.toFixed(1) + ' %' },
  ], ['Min', 'Mean', 'Max']);
}

function fmtAxisDate(ts) {
  const d = new Date(ts);
  if (range.hours <= 48) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (range.hours <= 24 * 14) return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' + d.getHours() + 'h';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

async function updateFlow() {
  const s = await fetchSeries(Q_FLOW(groupIntervalMin()));
  if (!s) return;
  const data = [[], [], [], []];
  for (const v of s.values) {
    data[0].push(v[0]);
    data[1].push(v[1] == null ? null : Math.round(v[1]));
    data[2].push(v[2] == null ? null : Math.round(v[2]));
    data[3].push(v[3] == null ? null : Math.round(v[3]));
  }
  // Battery fest BLAU (frueher dynamisch grün/rot – zu nah an PV-Grün)
  const batColor = '#5794f2';
  const opts = uplotBaseOpts(260, (u, vals) => vals.map(fmtW));
  opts.width = $('flowchart').clientWidth;
  opts.legend = { show: true, live: true };
  opts.cursor = { x: true, y: false, points: { show: false } };
  opts.series = [
    {},
    { label: 'PV power', stroke: '#73bf69', width: 1.5, fill: 'rgba(115,191,105,0.12)', spanGaps: true },
    { label: 'Consumption', stroke: '#ff9830', width: 1.5, fill: 'rgba(255,152,48,0.10)', spanGaps: true },
    { label: 'Battery', stroke: batColor, width: 1.5, fill: 'rgba(87,148,242,0.12)', spanGaps: true },
  ];
  if (!flowPlot) flowPlot = new uPlot(opts, data, $('flowchart'));
  else flowPlot.setData(data);
  renderLegendTable($('flowlegend'), [
    { label: 'PV power', color: '#73bf69', values: data[1], fmt: fmtW },
    { label: 'Consumption', color: '#ff9830', values: data[2], fmt: fmtW },
    { label: 'Battery', color: batColor, values: data[3], fmt: fmtW },
  ], ['Min', 'Mean', 'Max']);
}

/* ---------- Fehler-Ereignisse im Zeitraum (Error Active, 1-min-Gruppe) ---------- */
let errPlot = null;

function fmtDT(ts) {
  return new Date(ts).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

async function updateErrEvents() {
  // max() je Minute: 1 = irgendwann in dieser Minute ein echter Fehler aktiv
  const ivl = Math.max(groupIntervalMin(), 1);
  const q =
    `SELECT max("Error Active") AS err, last("Monitor Flags DE") AS flags ` +
    `FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND ${TF()} ` +
    `GROUP BY time(${ivl}m) fill(null)`;
  const s = await fetchSeries(q);
  const box = $('err-events');
  if (!s) { box.innerHTML = '<span class="dim">Keine Daten.</span>'; return; }

  // Zusammenhängende Minuten zu Perioden zusammenfassen
  const events = [];
  let cur = null;
  for (const v of s.values) {
    const on = v[1] != null && Number(v[1]) > 0;
    const t = new Date(v[0]).getTime();
    if (on) {
      if (!cur) cur = { start: t, end: t, flags: v[2] || '' };
      else cur.end = t;
    } else if (cur) {
      cur.end = Math.max(cur.end, t - 1); // vor der fehlerfreien Minute enden
      events.push(cur); cur = null;
    }
  }
  if (cur) events.push(cur);

  if (!events.length) {
    box.innerHTML =
      '<span class="ok-note">✓ Keine Fehler im gewählten Zeitraum</span>';
    return;
  }
  let html = '';
  for (const e of events.slice(-50).reverse()) { // neueste zuerst, max 50
    html += `<div class="err-event"><span class="err-ts">⚠ ${fmtDT(e.start)} – ${fmtDT(e.end)}</span>` +
      `<span class="err-what">${e.flags || 'Fehler aktiv'}</span></div>`;
  }
  const more = events.length > 50 ? `<div class="dim">(nur die neuesten 50 von ${events.length} Ereignissen)</div>` : '';
  box.innerHTML = html + more;
}

/* ---------- Tagesbilanz: Balken Erzeugt/Verbraucht + SOC-Linie ---------- */
// Stundliche Mittelwerte aus downsampled_1m, Aggregation auf Tage (lokale
// Zeitzone!) in JS – so stimmen die Tagesgrenzen auch bei Sommer/Winterzeit.
const Q_DAILY = () =>
  `SELECT mean("PV Power W") AS pv, mean("Consumption Power W") AS cons, ` +
  `mean("State of Charge") AS soc ` +
  `FROM "downsampled_1m"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND ${TF()} ` +
  `GROUP BY time(60m) fill(null)`;

let dailyPlot = null;

const fmtKwh = (v) => v == null ? '–' : Number(v).toFixed(2) + ' kWh';
const fmtPct = (v) => v == null ? '–' : Number(v).toFixed(0) + ' %';

function drawDailyBars(u) {
  const ctx = u.ctx;
  const n = u.data[0].length;
  if (n < 1) return;
  const step = n > 1 ? Math.abs(u.valToPos(u.data[0][1], 'x', true) - u.valToPos(u.data[0][0], 'x', true)) : u.bbox.w;
  const w = Math.max(3, Math.min(step * 0.72, 60));
  const y0 = u.valToPos(0, 'y', true);
  ctx.save();
  for (const [si, color] of [[1, 'rgba(115,191,105,0.75)'], [2, 'rgba(255,152,48,0.75)']]) {
    ctx.fillStyle = color;
    for (let i = 0; i < u.data[si].length; i++) {
      const v = u.data[si][i];
      if (v == null) continue;
      const x = u.valToPos(u.data[0][i], 'x', true);
      const y = u.valToPos(v, 'y', true);
      const top = v >= 0 ? y : y0;
      ctx.fillRect(x - w / 2, top, w, Math.max(1, Math.abs(y0 - y)));
    }
  }
  ctx.restore();
}

async function updateDaily() {
  const s = await fetchSeries(Q_DAILY());
  const box = $('dailylegend');
  if (!s) { box.innerHTML = ''; return; }

  // Stunden -> lokale Tages-Buckets (bei Zeiträumen <= 48 h: stündliche Balken)
  const hourly = range.hours <= 48;
  const buckets = new Map();
  for (const v of s.values) {
    if (v[1] == null && v[2] == null && v[3] == null) continue;
    const d = new Date(v[0]);
    const t0 = hourly
      ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime()
      : new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    let b = buckets.get(t0);
    if (!b) { b = { n: 0, pv: 0, cons: 0, soc: 0, socN: 0 }; buckets.set(t0, b); }
    b.n++;
    if (v[1] != null) b.pv += v[1];
    if (v[2] != null) b.cons += v[2];
    if (v[3] != null) { b.soc += v[3]; b.socN++; }
  }
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  if (!keys.length) { box.innerHTML = ''; return; }

  const data = [[], [], [], []];
  let maxAbs = 0.1;
  for (const t of keys) {
    const b = buckets.get(t);
    const pv = b.pv / 1000;                      // Stunden-Mittel (W) -> kWh
    const cons = -(b.cons / 1000);               // negativ = verbraucht
    const soc = b.socN ? b.soc / b.socN : null;
    data[0].push(t);
    data[1].push(Number(pv.toFixed(3)));
    data[2].push(Number(cons.toFixed(3)));
    data[3].push(soc == null ? null : Number(soc.toFixed(1)));
    maxAbs = Math.max(maxAbs, Math.abs(pv), Math.abs(cons));
  }
  // Y-Achse auf "netten" Wert runden
  const yMax = Math.max(1, Math.ceil(maxAbs * 1.15));
  const nice = yMax <= 2 ? 2 : yMax <= 5 ? 5 : Math.ceil(yMax / 5) * 5;

  const opts = uplotBaseOpts(260, (u, vals) => vals.map((v) => Number(v).toFixed(1) + ' kWh'));
  opts.width = $('dailychart').clientWidth;
  opts.legend = { show: false };
  opts.cursor = { x: true, y: false, points: { show: false } };
  opts.hooks = { draw: [drawDailyBars] };
  opts.series = [
    {},
    { label: 'Erzeugt (PV)', show: false, scale: 'kwh' },   // Balken (via draw-Hook)
    { label: 'Verbraucht', show: false, scale: 'kwh' },     // Balken (via draw-Hook)
    { label: 'SOC', stroke: '#5794f2', width: 1.5, scale: 'soc', spanGaps: true,
      points: { show: false }, dash: [4, 3] },
  ];
  opts.scales = { x: { time: true },
    kwh: { auto: false, range: [-nice, nice] },
    soc: { auto: false, range: [0, 100] } };
  opts.axes = [
    { stroke: '#8e8e8e', grid: { stroke: '#2c3235' }, ticks: { stroke: '#2c3235' },
      values: (u, vals) => {
        if (hourly) return vals.map((v) => new Date(v).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }));
        if (range.hours <= 24 * 730) return vals.map((v) => new Date(v).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }));
        return vals.map((v) => new Date(v).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }));
      } },
    { scale: 'kwh', stroke: '#8e8e8e', grid: { stroke: '#2c3235' }, ticks: { stroke: '#2c3235' }, side: 3, size: 62,
      values: (u, vals) => vals.map((v) => Number(v).toFixed(1)) },
    { scale: 'soc', stroke: '#5794f2', grid: { show: false }, ticks: { stroke: '#2c3235' }, side: 1, size: 50,
      values: (u, vals) => vals.map((v) => Number(v).toFixed(0) + '%') },
  ];
  if (!dailyPlot) dailyPlot = new uPlot(opts, data, $('dailychart'));
  else { dailyPlot.scales = opts.scales; dailyPlot.setData(data, true); }

  $('daily-hint').textContent = hourly ? 'stündlich' : 'pro Tag';
  renderLegendTable(box, [
    { label: 'Erzeugt (PV)', color: '#73bf69', values: data[1], fmt: fmtKwh },
    { label: 'Verbraucht', color: '#ff9830', values: data[2], fmt: (v) => v == null ? '–' : fmtKwh(Math.abs(v)) },
    { label: 'SOC (Mittel)', color: '#5794f2', values: data[3], fmt: fmtPct },
  ], ['Min', 'Mean', 'Max']);
}

/* ---------- Stats ---------- */
async function updateStats() {
  // Jede Stat einzeln – ein Fehler blockiert nicht die anderen
  const val = (row) => { for (const k in row || {}) if (k !== 'time') return row[k]; return null; };

  try {
    const pv = await fetchRow(Q_PV_KWH());
    const v = val(pv);
    $('stat-pv').firstChild.textContent = v == null ? '–' : Number(v).toFixed(2);
  } catch (e) { $('stat-pv').firstChild.textContent = '–'; }

  try {
    const lo = await fetchRow(Q_LOAD_KWH());
    const v = val(lo);
    $('stat-load').firstChild.textContent = v == null ? '–' : Number(v).toFixed(2);
  } catch (e) { $('stat-load').firstChild.textContent = '–'; }

  const cm = await fetchRow(Q_CELLMINS());
  const box = $('cellmins');
  if (firstMins) {
    box.innerHTML = '';
    for (let i = 1; i <= 8; i++) {
      const it = document.createElement('div');
      it.className = 'min-item';
      it.innerHTML = `<span class="ml">Cell ${i}</span><span class="mv" id="cm${i}">–</span>`;
      box.appendChild(it);
    }
    firstMins = false;
  }
  for (let i = 1; i <= 8; i++) {
    const el = $('cm' + i);
    const v = cm ? cm['c' + i] : null;
    if (v == null) { el.textContent = '–'; el.style.color = 'var(--txt)'; continue; }
    el.textContent = Number(v).toFixed(3) + ' V';
    el.style.color = v < 2.8 ? 'var(--red)' : v < 3.0 ? '#f2cc0c' : v < 3.65 ? 'var(--green)' : 'var(--red)';
  }

  const d = await fetchRow(Q_DELTA());
  histGauge.set(d ? (d.v == null ? null : Number(d.v)) : null);
}

/* Delta-Gauge (Thresholds wie Grafana: grün <100, gelb <150, rot) */
let histGauge = null, firstMins = true;
function buildHistGauge() {
  const size = 170, cx = size / 2, cy = size / 2, r = size / 2 - 8;
  const start = 135, sweep = 270, GMAX = 200;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.innerHTML = `<path id="hg-bg" fill="none" stroke="#22252b" stroke-width="12" stroke-linecap="round"/>
    <path id="hg-fill" fill="none" stroke="var(--green)" stroke-width="12" stroke-linecap="round"/>
    <text x="50%" y="52%" text-anchor="middle" id="hg-val">–</text>
    <text x="50%" y="66%" text-anchor="middle" class="gunit">mV</text>`;
  const arc = (deg) => {
    const a0 = (start * Math.PI) / 180, a1 = ((start + deg) * Math.PI) / 180;
    return `M ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 ${deg > 180 ? 1 : 0} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}`;
  };
  svg.querySelector('#hg-bg').setAttribute('d', arc(sweep));
  $('deltagauge').appendChild(svg);
  histGauge = {
    set(mv) {
      const fill = svg.querySelector('#hg-fill'), val = svg.querySelector('#hg-val');
      if (mv == null) { val.textContent = '–'; fill.setAttribute('d', ''); return; }
      const frac = Math.max(0, Math.min(1, mv / GMAX));
      fill.setAttribute('d', frac < 0.005 ? '' : arc(frac * sweep));
      fill.setAttribute('stroke', mv <= 100 ? 'var(--green)' : mv <= 150 ? '#f2cc0c' : 'var(--red)');
      val.textContent = mv.toFixed(0);
    },
  };
}

/* ---------- Reload bei Zeitraumwechsel ---------- */
async function loadAll() {
  $('status').textContent = 'lade…';
  try {
    await Promise.all([updateBatt(), updateFlow(), updateStats(), updateErrEvents(), updateDaily()]);
    $('status').textContent = 'Daten OK';
    $('status').classList.remove('err');
  } catch (e) {
    $('status').textContent = 'FEHLER: ' + e.message;
    $('status').classList.add('err');
  }
}

/* ---------- Init ---------- */

function onRangeChanged() {
  $('range-info').textContent = rangeInfoText();
  // Alte Charts sauber entfernen (uPlot haengt sonst neues DOM an!)
  if (battPlot) { battPlot.destroy(); battPlot = null; }
  if (flowPlot) { flowPlot.destroy(); flowPlot = null; }
  loadAll();
}

/* ---------- Init ---------- */
buildHistGauge();
$('range-info').textContent = rangeInfoText();
setRangeHours(720); // Default 30 Tage
setInterval(loadAll, 5 * 60000);  // alle 5 min aktualisieren

window.addEventListener('resize', () => {
  battPlot && battPlot.setSize({ width: $('battchart').clientWidth, height: 300 });
  flowPlot && flowPlot.setSize({ width: $('flowchart').clientWidth, height: 260 });
  dailyPlot && dailyPlot.setSize({ width: $('dailychart').clientWidth, height: 260 });
});
