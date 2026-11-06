/* SBMS0 – gemeinsam genutzte Helfer (Live-Web) */
'use strict';

const $ = (id) => document.getElementById(id);
const fmt = (v, d = 2) => (v == null ? '–' : Number(v).toFixed(d));

function extract(res) {
  try {
    const s = res.results?.[0]?.series?.[0];
    if (!s || !s.values || !s.values.length) return null;
    const row = {};
    s.columns.forEach((c, i) => { row[c] = s.values[0][i]; });
    return { row, columns: s.columns, values: s.values };
  } catch (e) { return null; }
}

async function fetchQ(q) {
  const r = await fetch('/query?q=' + encodeURIComponent(q));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.json();
}

async function fetchRow(q) {
  const e = extract(await fetchQ(q));
  return e ? e.row : null;
}

async function fetchSeries(q) {
  const e = extract(await fetchQ(q));
  return e ? { columns: e.columns, values: e.values } : null;
}

/* ---- Threshold-Ramp (Grafana-Gradient) ---- */
function ramp(stops, v) {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [v0, c0] = stops[i - 1], [v1, c1] = stops[i];
      const t = (v - v0) / (v1 - v0);
      return c0.map((c, j) => Math.round(c + t * (c1[j] - c)));
    }
  }
  return stops[stops.length - 1][1];
}
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const dim = (c, f = 0.28) => c.map((x) => Math.round(x * f + 0x22 * (1 - f)));

function setLedBar(leds, min, max, stops, value, colorFn) {
  if (value == null) return;
  const cfn = colorFn || ((v) => ramp(stops, v));
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const on = Math.round(frac * leds.length);
  for (let i = 0; i < leds.length; i++) {
    const c = cfn(min + (i + 0.5) * (max - min) / leds.length);
    if (i < on) {
      leds[i].classList.add('on');
      leds[i].style.background = rgb(c);
    } else {
      leds[i].classList.remove('on');
      leds[i].style.background = rgb(dim(c));
    }
  }
}

function buildLedBar(el, n, min, max, stops) {
  el.innerHTML = '';
  const leds = [];
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = 'led';
    const v = min + (i + 0.5) * (max - min) / n;
    d.style.background = rgb(dim(ramp(stops, v)));
    el.appendChild(d);
    leds.push(d);
  }
  return leds;
}

/* ---- Grafana-Legende (frei wählbare Kennzahlen) ---- */
function renderLegendTable(el, series, calcs) {
  // series: [{label, color, values:[...]}], calcs z.B. ['Min','Mean','Max']
  const cols = calcs || ['Min', 'Max', 'Last*'];
  const stat = (vals, kind) => {
    const v = vals.filter((x) => x != null);
    if (!v.length) return '–';
    switch (kind) {
      case 'Min': return Math.min(...v);
      case 'Max': return Math.max(...v);
      case 'Mean': return v.reduce((a, b) => a + b, 0) / v.length;
      default: { // Last*
        for (let j = vals.length - 1; j >= 0; j--) if (vals[j] != null) return vals[j];
        return null;
      }
    }
  };
  let html = '<table class="legend-table"><tr><th>Name</th>' +
    cols.map((c) => `<th>${c}</th>`).join('') + '</tr>';
  for (const s of series) {
    html += `<tr><td><span class="lg-dot" style="background:${s.color}"></span>${s.label}</td>` +
      cols.map((c) => `<td>${s.fmt(stat(s.values, c.split('*')[0]))}</td>`).join('') + '</tr>';
  }
  html += '</table>';
  el.innerHTML = html;
}

/* ---- uPlot-Default-Optionen (Grafana-Dark-Look) ---- */
function uplotBaseOpts(height, yFmt) {
  return {
    height,
    legend: { show: false },
    scales: { x: { time: true } },
    axes: [
      { stroke: '#8e8e8e', grid: { stroke: '#2c3235' }, ticks: { stroke: '#2c3235' },
        values: (u, vals) => vals.map((v) => new Date(v).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })) },
      { stroke: '#8e8e8e', grid: { stroke: '#2c3235' }, ticks: { stroke: '#2c3235' }, values: yFmt },
    ],
  };
}
