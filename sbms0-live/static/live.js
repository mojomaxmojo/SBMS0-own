/* SBMS0 Live-Web – Grafana-Look (LED-Bargauges, Stats, Gauge, uPlot-Chart)
   Benötigt shared.js ($, fmt, fetchRow, fetchSeries, ramp, rgb, dim, setLedBar, buildLedBar) */
'use strict';

const Q_LAST =
  "SELECT last(\"State of Charge\") AS SOC, last(\"Battery Voltage\") AS Vbat, " +
  "last(\"Battery Current\") AS Ibat, last(\"PV Total Current\") AS IPV, " +
  "last(\"External Load\") AS Iload, last(\"Cell Delta\") AS delta, " +
  "last(\"Internal Temperature\") AS Tint, last(\"External Temperature\") AS Text, " +
  "last(\"Monitor Flags DE\") AS flags, last(\"Error Code\") AS errcode, " +
  "last(\"Error Active\") AS erractive " +
  "FROM \"raw_1s\".\"SBMS_Metrics\" WHERE \"Name\" = 'SBMS0a' AND time > now() - 30s";

const Q_CELLS =
  "SELECT last(\"Cell 1\") AS c1, last(\"Cell 2\") AS c2, last(\"Cell 3\") AS c3, " +
  "last(\"Cell 4\") AS c4, last(\"Cell 5\") AS c5, last(\"Cell 6\") AS c6, " +
  "last(\"Cell 7\") AS c7, last(\"Cell 8\") AS c8 " +
  "FROM \"raw_1s\".\"SBMS_Metrics\" WHERE \"Name\" = 'SBMS0a' AND time > now() - 30s";

// Today-Chart: 1-Min-Mittelwerte aus downsampled_1m (wie Grafana-Panel)
const Q_TODAY =
  "SELECT mean(\"Battery Power W\") AS bat, mean(\"PV Power W\") AS pv, " +
  "mean(\"Consumption Power W\") AS cons " +
  "FROM \"downsampled_1m\".\"SBMS_Metrics\" WHERE \"Name\" = 'SBMS0a' AND time > now() - 24h " +
  "GROUP BY time(1m) fill(null)";

/* ---------- Farb-Stops (Grafana-Thresholds) ---------- */
const SOC_STOPS = [
  [0, [0x66, 0x0e, 0x0e]],   // dark-red
  [10, [0xf2, 0x49, 0x5c]],  // light-red
  [20, [0xff, 0xb3, 0x57]],  // super-light-orange
  [30, [0x96, 0xd9, 0x8d]],  // super-light-green
  [40, [0x73, 0xbf, 0x69]],  // green
  [80, [0x56, 0xa6, 0x4b]],  // semi-dark-green
  [100, [0x37, 0x92, 0x6c]], // dark-green
];

const CELL_STOPS = [
  [2.8, [0xf2, 0xcc, 0x0c]],  // yellow
  [3.0, [0x96, 0xd9, 0x8d]],  // light-green
  [3.2, [0x73, 0xbf, 0x69]],  // green
  [3.65, [0xf2, 0x49, 0x5c]], // red
];
const CELL_BASE = [0xf2, 0x49, 0x5c]; // Base: rot – unter 2.8 V solid rot (auch < 2.5 V)
const cellColorRaw = (v) => (v < 2.8 ? CELL_BASE : ramp(CELL_STOPS, v));
const socColorRaw = (soc) => ramp(SOC_STOPS, soc);

/* ---------- LED-Bargauges ---------- */
const SOC_LEDS = buildLedBar($('soc-bar'), 100, 0, 100, SOC_STOPS);
const CELL_LEDS = [];
for (let i = 1; i <= 8; i++) {
  const row = document.createElement('div');
  row.className = 'cell-row';
  row.innerHTML =
    `<span class="cname">Cell ${i}</span>` +
    `<div class="ledbar"></div>` +
    `<span class="cval">–</span>`;
  $('cells').appendChild(row);
  CELL_LEDS.push({
    leds: buildLedBar(row.querySelector('.ledbar'), 130, 2.5, 3.8, CELL_STOPS),
    val: row.querySelector('.cval'),
  });
}

/* ---------- Delta-Gauge (SVG-Arc) ---------- */
const GAUGE_MAX = 100; // mV
function buildGauge() {
  const size = 150, cx = size / 2, cy = size / 2, r = size / 2 - 8;
  const start = 135, sweep = 270; // Grad
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.innerHTML = `
    <path id="g-bg" fill="none" stroke="#22252b" stroke-width="12"
      stroke-linecap="round"/>
    <path id="g-fill" fill="none" stroke="var(--green)" stroke-width="12"
      stroke-linecap="round"/>
    <text x="50%" y="52%" text-anchor="middle" id="g-val">–</text>
    <text x="50%" y="66%" text-anchor="middle" class="gunit">mV</text>`;
  const arc = (deg) => {
    const a0 = (start * Math.PI) / 180;
    const a1 = ((start + deg) * Math.PI) / 180;
    const large = deg > 180 ? 1 : 0;
    return `M ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} ` +
      `A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}`;
  };
  svg.querySelector('#g-bg').setAttribute('d', arc(sweep));
  $('gauge').appendChild(svg);
  return {
    set(mv) {
      const fill = svg.querySelector('#g-fill'), val = svg.querySelector('#g-val');
      if (mv == null) { val.textContent = '–'; fill.setAttribute('d', ''); return; }
      const frac = Math.max(0, Math.min(1, mv / GAUGE_MAX));
      fill.setAttribute('d', frac < 0.005 ? '' : arc(frac * sweep));
      fill.setAttribute('stroke', mv <= 20 ? 'var(--green)' : mv <= 50 ? 'var(--orange)' : 'var(--red)');
      val.textContent = mv.toFixed(0);
    },
  };
}
const gauge = buildGauge();

/* ---------- Heute-Chart (uPlot) ---------- */
let uplotChart = null;
async function updateChart() {
  let res;
  try {
    const r = await fetch('/query?q=' + encodeURIComponent(Q_TODAY));
    res = await r.json();
  } catch (e) { return; }
  const s = res?.results?.[0]?.series?.[0];
  if (!s) return;
  const data = [[], [], [], []];
  for (const v of s.values) {
    data[0].push(v[0]);
    data[1].push(v[1] == null ? null : Math.round(v[1]));
    data[2].push(v[2] == null ? null : Math.round(v[2]));
    data[3].push(v[3] == null ? null : Math.round(v[3]));
  }
  const opts = uplotBaseOpts(300,
    (u, vals) => vals.map((v) => (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + ' kW' : v + ' W')));
  opts.width = $('powerchart').clientWidth;
  opts.legend = { show: true, live: true };
  opts.cursor = { x: true, y: false, points: { show: false } };
  opts.series = [
    {},
    { label: 'Battery Power', stroke: '#5794f2', width: 1.5, fill: 'rgba(87,148,242,0.15)', spanGaps: true },
    { label: 'PV Power', stroke: '#73bf69', width: 1.5, fill: 'rgba(115,191,105,0.12)', spanGaps: true },
    { label: 'Load Power', stroke: '#ff9830', width: 1.5, fill: 'rgba(255,152,48,0.10)', spanGaps: true },
  ];
  if (!uplotChart) uplotChart = new uPlot(opts, data, $('powerchart'));
  else uplotChart.setData(data);
  renderLegendTable($('legend'), [
    { label: 'Battery Power', color: '#5794f2', values: data[1], fmt: fmtW },
    { label: 'PV Power', color: '#73bf69', values: data[2], fmt: fmtW },
    { label: 'Load Power', color: '#ff9830', values: data[3], fmt: fmtW },
  ]);
}

function fmtW(v) {
  if (v == null) return '–';
  const a = Math.abs(v);
  if (a >= 1000) return (v / 1000).toFixed(2) + ' kW';
  return v.toFixed(2) + ' W';
}

// Chart nur alle 60 s aktualisieren (1-Min-Daten!)
updateChart();
setInterval(updateChart, 60000);
window.addEventListener('resize', () => uplotChart && uplotChart.setSize({ width: $('powerchart').clientWidth, height: 300 }));

/* ---------- 1s-Tick: Live-Werte ---------- */
function update(row, cells) {
  if (!row) {
    $('status').textContent = 'KEINE DATEN / Influx unerreichbar';
    $('status').classList.add('err');
    return;
  }
  $('status').textContent = 'Daten OK';
  $('status').classList.remove('err');

  $('clock').textContent = new Date().toLocaleTimeString('de-DE');
  $('clock2').textContent = new Date().toLocaleString('de-DE');

  // SOC
  const soc = Number(row.SOC);
  setLedBar(SOC_LEDS, 0, 100, SOC_STOPS, soc);
  $('soc-num').textContent = soc.toFixed(0);
  // % Zahl in der Farbe des SOC-Balkens
  const socC = socColorRaw(soc);
  const c = rgb(socC);
  $('soc-num').style.color = c;
  if ($('soc-num').nextElementSibling) $('soc-num').nextElementSibling.style.color = c;

  // Leistungen
  const vbat = Number(row.Vbat);
  const ibat = Number(row.Ibat), ipv = Number(row.IPV);
  const pBat = ibat * vbat, pPv = ipv * vbat, pLoad = (ipv - ibat) * vbat;
  $('p-pv').textContent = fmt(pPv, 0);
  $('p-bat').textContent = fmt(pBat, 0);
  $('p-load').textContent = fmt(pLoad, 0);
  $('p-currents').textContent =
    `PV ${fmt(ipv, 2)} A · Batt ${fmt(ibat, 2)} A · Last ${fmt(row.Iload, 2)} A · ` +
    `Int ${fmt(row.Tint, 1)} °C · Ext ${fmt(row.Text, 1)} °C`;

  // Akku-Zeile in der Time/Flags-Karte
  $('akku-line').textContent =
    `${fmt(vbat)} V · ${ibat > 0.05 ? 'lädt ' + fmt(ibat) + ' A' : ibat < -0.05 ? 'entlädt ' + fmt(-ibat) + ' A' : 'Ruhe'}`;

  // Zellen
  for (let i = 1; i <= 8; i++) {
    const v = cells ? cells['c' + i] : null;
    const c = CELL_LEDS[i - 1];
    if (v == null) { c.val.textContent = '–'; continue; }
    setLedBar(c.leds, 2.5, 3.8, CELL_STOPS, Number(v), cellColorRaw);
    c.val.textContent = Number(v).toFixed(3) + ' V';
  }

  // Delta
  gauge.set(row.delta == null ? null : Number(row.delta) * 1000);

  // Flags
  const flags = String(row.flags || '') || '(keine)';
  const activeErr = Number(row.erractive) > 0;
  $('flags-de').textContent = activeErr
    ? `⚠ FEHLER ${row.errcode}: ${flags}` : flags;
  $('flags-de').classList.toggle('err', activeErr);
}

async function tick() {
  try {
    const [row, cells] = await Promise.all([fetchRow(Q_LAST), fetchRow(Q_CELLS)]);
    update(row, cells);
  } catch (e) {
    $('status').textContent = 'FEHLER: ' + e.message;
    $('status').classList.add('err');
  }
}

tick();
setInterval(tick, 1000);
