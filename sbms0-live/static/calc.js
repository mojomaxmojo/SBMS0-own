/* SBMS0 BERECHNUNGEN – 1:1 wie das Grafana-Dashboard (Reihenfolge, Farben) */
'use strict';

// Today = ab lokalem Mitternacht (wie Grafana now/d) – Nanosekunden-Integer (InfluxQL-sicher)
const _startOfDay = new Date(); _startOfDay.setHours(0, 0, 0, 0);
const FROM_TODAY = `time > ${Math.round(_startOfDay.getTime() * 1e6)}`;

/* ---------- Energie heute (Bargauge links) ---------- */
const Q_ENERGY = [
  { alias: 'Erzeugt',   color: '#73bf69', q: `SELECT sum("PV Power W") / 3600 / 1000 FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND ${FROM_TODAY}` },
  { alias: 'Geladen',   color: '#f2cc0c', q: `SELECT sum("Battery Power W") / 3600 / 1000 FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND "Battery Power W" > 0 AND ${FROM_TODAY}` },
  { alias: 'Entladen',  color: '#f2495c', q: `SELECT sum("Battery Power W") / 3600 / 1000 * -1 FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND "Battery Power W" < 0 AND ${FROM_TODAY}` },
  { alias: 'Verbraucht',color: '#ff9830', q: `SELECT sum("Consumption Power W") / 3600 / 1000 FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND ${FROM_TODAY}` },
];

// Statische Bar-Struktur (Label + LED-Bar + Wert), Farben wie Grafana-Overrides
const ENERGY_BARS = [];
{
  const box = $('energy-bars');
  for (const t of Q_ENERGY) {
    const row = document.createElement('div');
    row.className = 'cell-row';
    row.innerHTML =
      `<span class="cname wide">${t.alias}</span>` +
      `<div class="ledbar thin"></div>` +
      `<span class="cval">–</span>`;
    box.appendChild(row);
    const leds = buildLedBar(row.querySelector('.ledbar'), 60, 0, 7, [[0, [0x73,0xbf,0x69]], [7, [0xf2,0x49,0x5c]]]);
    ENERGY_BARS.push({ ...t, leds, val: row.querySelector('.cval'), barEl: row.querySelector('.ledbar') });
  }
}

function fmtKwh(v) { return v == null ? '–' : Number(v).toFixed(2) + ' kWh'; }

async function updateEnergy() {
  for (const b of ENERGY_BARS) {
    try {
      const row = await fetchRow(b.q);
      // Erster Wert != 'time' (Influx liefert Zeitstempel als erste Spalte)
      let v = null;
      if (row) for (const k in row) { if (k !== 'time') { v = row[k]; break; } }
      if (v == null) { b.val.textContent = '–'; continue; }
      const num = Number(v);
      setLedBar(b.leds, 0, 7, [[0, [0x73,0xbf,0x69]], [7, [0xf2,0x49,0x5c]]], Math.min(num, 7),
        () => hexToRgbArr(b.color));
      b.val.textContent = fmtKwh(num);
    } catch (e) { b.val.textContent = 'Fehler'; }
  }
}
function hexToRgbArr(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}

/* ---------- Energy flow (heute) – Chart rechts ---------- */
const Q_FLOW =
  `SELECT mean("PV Power W") AS pv, mean("Consumption Power W") AS cons, mean("Battery Power W") AS bat ` +
  `FROM "downsampled_1m"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND ${FROM_TODAY} GROUP BY time(1m) fill(null)`;

let flowPlot = null;
async function updateFlow() {
  const s = await fetchSeries(Q_FLOW);
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
  const opts = uplotBaseOpts(220,
    (u, vals) => vals.map((v) => (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + ' kW' : v + ' W')));
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
    { label: 'PV power', color: '#73bf69', values: data[1], fmt: fmtWLegend },
    { label: 'Consumption', color: '#ff9830', values: data[2], fmt: fmtWLegend },
    { label: 'Battery', color: batColor, values: data[3], fmt: fmtWLegend },
  ], ['Min', 'Mean', 'Max']);
}
function fmtWLegend(v) {
  if (v == null) return '–';
  const a = Math.abs(v);
  if (a >= 1000) return (v / 1000).toFixed(0) + ' kW';
  return v.toFixed(0) + ' W';
}

/* ---------- Prognosen (Time to full/empty) ---------- */
const TTF_STOPS = [[0, [0x73,0xbf,0x69]], [480, [0xea,0xb8,0x39]], [1440, [0xf2,0x49,0x5c]]];
const TTE_STOPS = [[0, [0xf2,0x49,0x5c]], [7, [0xea,0xb8,0x39]], [100, [0x73,0xbf,0x69]]];

function fmtMin(v) {
  if (v == null) return '–';
  const m = Math.round(v);
  if (m >= 1440) return (m / 1440).toFixed(1) + ' d';
  if (m >= 60) return (m / 60).toFixed(1) + ' h';
  return m + ' min';
}

function buildProgBars(boxId, defs) {
  const box = $(boxId);
  const out = [];
  for (const d of defs) {
    const row = document.createElement('div');
    row.className = 'prog';
    row.innerHTML =
      `<div class="pname">${d.alias}</div>` +
      `<div class="prow"><div class="ledbar"></div><span class="pval">–</span></div>`;
    box.appendChild(row);
    out.push({ ...d, leds: buildLedBar(row.querySelector('.ledbar'), 60, 0, d.max, d.stops), val: row.querySelector('.pval'), el: row });
  }
  return out;
}

const TTF_BARS = buildProgBars('ttf-bars', [
  { alias: 'Current (5m)', max: 2880, stops: TTF_STOPS,
    q: `SELECT (280 *(100 - "State of Charge") / 100) / (("Battery Current" + ABS("Battery Current")) / 2) * 60 AS v FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND "Battery Current" > 0 AND time > now() -5m` },
  { alias: 'Last 1h', max: 2880, stops: TTF_STOPS,
    q: `SELECT (280 *(100 - "State of Charge") / 100) / (("Battery Current" + ABS("Battery Current")) / 2) * 60 AS v FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND "Battery Current" > 0 AND time > now() -1h` },
]);
const TTE_BARS = buildProgBars('tte-bars', [
  { alias: 'Current (5m)', max: 14400, stops: TTE_STOPS,
    q: `SELECT (280 * "State of Charge" / 100) / ((-"Battery Current" + ABS("Battery Current")) / 2) * 60 AS v FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND "Battery Current" < 0 AND time > now() -5m` },
  { alias: 'Last 1h', max: 14400, stops: TTE_STOPS,
    q: `SELECT (280 * "State of Charge" / 100) / ("PV Total Current" - "Battery Current") * 60 AS v FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND ("PV Total Current" - "Battery Current") > 0 AND time > now() -1h` },
  { alias: 'Last 24h', max: 14400, stops: TTE_STOPS,
    q: `SELECT (280 * "State of Charge" / 100) / ("PV Total Current" - "Battery Current") * 60 AS v FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND ("PV Total Current" - "Battery Current") > 0 AND time > now() -24h` },
]);

// Status-Zeile (Hinweistext wie Grafana-Value-Mapping)
const Q_TTF_STATUS = `SELECT last("State of Charge") - last("State of Charge") AS v FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND "Battery Current" <= 0 AND time > now() - 1m`;
const Q_TTE_STATUS = `SELECT last("State of Charge") - last("State of Charge") AS v FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND "Battery Current" >= 0 AND time > now() - 1m`;

function statusCenter(el, text) {
  let line = el.querySelector('.status-center');
  if (!line) {
    line = document.createElement('div');
    line.className = 'status-center';
    // Zentrierter Status über die Panel-Mitte (wie Grafana "No data"-Text)
    el.querySelectorAll('.prog').forEach((p) => (p.style.display = 'none'));
    el.appendChild(line);
  }
  line.textContent = text;
  line.style.display = text ? 'flex' : 'none';
  if (!text) el.querySelectorAll('.prog').forEach((p) => (p.style.display = ''));
}

async function updateProg(bars, statusQ, statusMsg, panelId) {
  let anyData = false;
  for (const b of bars) {
    try {
      const row = await fetchRow(b.q);
      const v = row ? row.v : null;
      if (v == null) { b.val.textContent = '–'; continue; }
      anyData = true;
      const num = Number(v);
      setLedBar(b.leds, 0, b.max, b.stops, Math.min(num, b.max));
      b.val.textContent = fmtMin(num);
      // Wert-Farbe wie Grafana-Thresholds
      b.val.style.color = b.stops === TTF_STOPS
        ? (num <= 480 ? 'var(--green)' : num <= 1440 ? 'var(--orange)' : 'var(--red)')
        : (num <= 7 ? 'var(--red)' : num <= 100 ? 'var(--orange)' : 'var(--green)');
    } catch (e) { b.val.textContent = 'Fehler'; }
  }
  const panel = $(panelId);
  if (!anyData) {
    try {
      const row = await fetchRow(statusQ);
      if (row && row.v != null) { statusCenter(panel, statusMsg); return; }
    } catch (e) { /* ignore */ }
  }
  statusCenter(panel, '');
}

/* ---------- Battery Levels (heute) – 2 Achsen ---------- */
const Q_BATLEVELS =
  `SELECT mean("Battery Voltage") AS volt, mean("State of Charge") AS soc ` +
  `FROM "downsampled_1m"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND ${FROM_TODAY} GROUP BY time(1m) fill(null)`;

let battPlot = null;
async function updateBatLevels() {
  const s = await fetchSeries(Q_BATLEVELS);
  if (!s) return;
  const data = [[], [], []];
  for (const v of s.values) {
    data[0].push(v[0]);
    data[1].push(v[1] == null ? null : Number(v[1]));
    data[2].push(v[2] == null ? null : Number(v[2]));
  }
  const opts = uplotBaseOpts(300,
    (u, vals) => vals.map((v) => v.toFixed(2) + ' V'));
  opts.width = $('battchart').clientWidth;
  opts.legend = { show: true, live: true };
  opts.cursor = { x: true, y: false, points: { show: false } };
  opts.series = [
    {},
    { label: 'Voltage', stroke: '#5794f2', width: 2, spanGaps: true, scale: 'volt',
      fill: 'rgba(87,148,242,0.12)' },
    { label: 'SOC', stroke: '#73bf69', width: 2, spanGaps: true, scale: 'soc',
      // gepunktet wie Grafana (dash [0,10] zeichnet in uPlot nichts -> Punkte nutzen)
      points: { show: true, size: 3, stroke: '#73bf69', fill: '#73bf69', space: 8 },
      fill: 'rgba(115,191,105,0.18)' },
  ];
  opts.scales = { x: { time: true },
    volt: { auto: true, range: (u, dmin, dmax) => [Math.floor(dmin) , Math.ceil(dmax)] },
    soc: { auto: true, range: [0, 100] } };
  opts.axes = [
    { stroke: '#8e8e8e', grid: { stroke: '#2c3235' }, ticks: { stroke: '#2c3235' },
      values: (u, vals) => vals.map((v) => new Date(v).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })) },
    // size explizit setzen, sonst wird bei "26.50 V" die fuehrende 2 abgeschnitten!
    { scale: 'volt', stroke: '#5794f2', grid: { stroke: '#2c3235' }, ticks: { stroke: '#2c3235' }, side: 3, size: 70,
      values: (u, vals) => vals.map((v) => Number(v).toFixed(2) + ' V') },
    { scale: 'soc', stroke: '#73bf69', grid: { show: false }, ticks: { stroke: '#2c3235' }, side: 1, size: 60,
      values: (u, vals) => vals.map((v) => Number(v).toFixed(0) + ' %') },
  ];
  if (!battPlot) battPlot = new uPlot(opts, data, $('battchart'));
  else battPlot.setData(data);
  renderLegendTable($('battlegend'), [
    { label: 'Voltage', color: '#5794f2', values: data[1], fmt: (v) => v == null ? '–' : v.toFixed(2) + ' V' },
    { label: 'SOC', color: '#73bf69', values: data[2], fmt: (v) => v == null ? '–' : v.toFixed(1) + ' %' },
  ], ['Min', 'Mean', 'Max']);
}

/* ---------- Cell Voltages (Verlauf) – RAW 1s-Daten (wie Grafana, Ausschläge sichtbar) ---------- */
const Q_CELLVERLAUF =
  `SELECT "Cell 1" AS c1, "Cell 2" AS c2, "Cell 3" AS c3, "Cell 4" AS c4, ` +
  `"Cell 5" AS c5, "Cell 6" AS c6, "Cell 7" AS c7, "Cell 8" AS c8 ` +
  `FROM "raw_1s"."SBMS_Metrics" WHERE ("Name" = 'SBMS0a') AND ${FROM_TODAY}`;

// Grafana palette-classic Farben
const PALETTE = ['#73bf69', '#5794f2', '#ff9830', '#f2495c', '#b3d4ff', '#f2cc0c', '#c15ca8', '#8ab8ff'];
function hexA(hex, a) {
  return `rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${a})`;
}
let cellsPlot = null;
async function updateCellsVerlauf() {
  const s = await fetchSeries(Q_CELLVERLAUF);
  if (!s) return;
  const data = [[], [], [], [], [], [], [], [], []];
  for (const v of s.values) {
    data[0].push(v[0]);
    for (let i = 1; i <= 8; i++) data[i].push(v[i] == null ? null : Number(v[i]));
  }
  const opts = uplotBaseOpts(300,
    (u, vals) => vals.map((v) => v.toFixed(3) + ' V'));
  opts.width = $('cellschart').clientWidth;
  // Grafana-Look: Flächenfüllung + Live-Werte bei Maus-Hover
  opts.legend = { show: true, live: true, mount: () => {} };
  opts.cursor = { x: true, y: false, points: { show: false } };
  opts.series = [{}];
  const legendSeries = [];
  for (let i = 1; i <= 8; i++) {
    opts.series.push({
      label: `Cell ${i}`, stroke: PALETTE[i - 1], width: 1, spanGaps: true,
      scale: 'v', points: { show: false },
      fill: hexA(PALETTE[i - 1], 0.08),
      value: (u, v) => v == null ? '–' : v.toFixed(3) + ' V',
    });
    legendSeries.push({ label: `Cell ${i}`, color: PALETTE[i - 1], values: data[i], fmt: (v) => v == null ? '–' : v.toFixed(3) + ' V' });
  }
  opts.scales = { x: { time: true }, v: { auto: true, range: [2.5, 3.8] } };
  if (!cellsPlot) cellsPlot = new uPlot(opts, data, $('cellschart'));
  else cellsPlot.setData(data);
  renderLegendTable($('cellslegend'), legendSeries, ['Min', 'Mean', 'Max']);
}

/* ---------- Ticker ---------- */
async function tickSlow() {
  $('status').textContent = 'Daten OK';
  $('clock').textContent = new Date().toLocaleTimeString('de-DE');
  await Promise.all([updateEnergy(), updateFlow(), updateBatLevels()]);
}
async function tickFast() {
  await Promise.all([
    updateProg(TTF_BARS, Q_TTF_STATUS, '– lädt gerade nicht (entlädt)', 'ttf-panel'),
    updateProg(TTE_BARS, Q_TTE_STATUS, '– entlädt gerade nicht (lädt)', 'tte-panel'),
  ]);
}
async function tickCells() {
  await updateCellsVerlauf();
}

Promise.all([tickSlow(), tickFast(), tickCells()]);
setInterval(tickSlow, 60000);    // 1-Min-Daten
setInterval(tickFast, 10000);    // Prognosen (Rohdaten) öfter
setInterval(tickCells, 120000);  // Cell-Verlauf: RAW-Daten, weniger häufig (großes Payload)

window.addEventListener('resize', () => {
  flowPlot && flowPlot.setSize({ width: $('flowchart').clientWidth, height: 220 });
  battPlot && battPlot.setSize({ width: $('battchart').clientWidth, height: 300 });
  cellsPlot && cellsPlot.setSize({ width: $('cellschart').clientWidth, height: 300 });
});
