/* SBMS0 WETTER – 24 h Ist+Vorhersage, 7-Tage-Kacheln (Daten: /weather, 30-min-Cache) */
'use strict';

setInterval(() => {
  const c = $('clock');
  if (c) c.textContent = new Date().toLocaleTimeString('de-DE');
}, 1000);

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) {
    let msg = 'HTTP ' + r.status;
    try { msg = (await r.json()).error || msg; } catch (e) { /* egal */ }
    throw new Error(msg);
  }
  return await r.json();
}

/* --- 24-h-Verlauf: Ist-Real (Influx) + Prognose (Modell) + Wetter --- */
let wPlot = null;

async function update24(w) {
  // Fenster: -24 h bis +24 h aus dem 15-Tage-Datensatz
  const now = Date.now();
  const times = w.times.map((t) => new Date(t.replace(' ', 'T')).getTime());
  let i0 = 0;
  for (let i = 0; i < times.length; i++) {
    if (times[i] >= now - 24 * 3600e3) { i0 = i; break; }
  }
  let i1 = times.length - 1;
  for (let i = times.length - 1; i >= 0; i--) {
    if (times[i] <= now + 24 * 3600e3) { i1 = i; break; }
  }
  const slice = (arr) => arr.slice(i0, i1 + 1);
  const tX = slice(times);
  const fcW = slice(w.watts).map((v) => v == null ? null : Number(v));

  // Ist-Real aus Influx: stündliche Mittel der letzten 24 h (epoch ms)
  const q = encodeURIComponent(
    'SELECT mean("PV Power W") FROM "raw_1s"."SBMS_Metrics" ' +
    "WHERE \"Name\"='SBMS0a' AND time > now() - 24h GROUP BY time(1h) fill(null)");
  const r = await fetch('/query?q=' + q);
  const j = await r.json();
  const real = new Array(tX.length).fill(null);
  const s = j?.results?.[0]?.series?.[0];
  if (s) {
    for (const v of s.values) {
      const ts = v[0]; // UTC-Stunde (Bucket-Start), epoch ms
      // Bucket Start -> in die Mitte des Fensters mappen (auf nächsten Index)
      for (let k = 0; k < tX.length; k++) {
        if (tX[k] >= ts && tX[k] < ts + 3600e3) { real[k] = v[1] == null ? null : Number(v[1]); break; }
      }
    }
  }

  const temp = slice(w.hourly.temp).map((v) => v == null ? null : Number(v));
  const wind = slice(w.hourly.wind).map((v) => v == null ? null : Number(v));
  const gusts = slice(w.hourly.gusts).map((v) => v == null ? null : Number(v));
  const cloud = slice(w.hourly.cloud).map((v) => v == null ? null : Number(v));
  const precipP = slice(w.hourly.precip_prob).map((v) => v == null ? null : Number(v));

  const opts = uplotBaseOpts(300, (u, vals) => vals.map((v) => Math.round(v)));
  opts.width = $('wchart24').clientWidth;
  opts.legend = { show: false };
  opts.cursor = { x: true, y: false, points: { show: false } };
  opts.series = [
    {},
    { label: 'PV Ist (W)', stroke: '#5794f2', width: 2, scale: 'w', spanGaps: true, points: { show: false } },
    { label: 'PV Prognose (W)', stroke: '#73bf69', width: 2, scale: 'w', spanGaps: true, points: { show: false } },
    { label: 'Temp (°C)', stroke: '#f2495c', width: 1.5, scale: 't', spanGaps: true, points: { show: false } },
    { label: 'Wind (km/h)', stroke: '#ff9830', width: 1.5, scale: 'w10', spanGaps: true, points: { show: false } },
    { label: 'Böen (km/h)', stroke: '#ff9830', width: 1, scale: 'w10', spanGaps: true, dash: [4, 3], points: { show: false } },
    { label: 'Bewölkung (%)', stroke: '#b3d4ff', width: 1.5, scale: 'pct', spanGaps: true, points: { show: false } },
    { label: 'Regen-Wahr. (%)', stroke: '#5794f2', width: 1, scale: 'pct', spanGaps: true, dash: [2, 3], points: { show: false } },
  ];
  opts.scales = { x: { time: true },
    w: { auto: true },
    t: { auto: true },
    w10: { auto: true, range: [0, Math.max(30, Math.max(...gusts.filter((v) => v != null), 0) * 1.15)] },
    pct: { auto: false, range: [0, 100] } };
  opts.axes = [
    { stroke: '#8e8e8e', grid: { stroke: '#2c3235' }, ticks: { stroke: '#2c3235' },
      values: (u, vals) => vals.map((v) => {
        const d = new Date(v);
        return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' +
          d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      }) },
    { scale: 'w', stroke: '#73bf69', grid: { stroke: '#2c3235' }, ticks: { stroke: '#2c3235' }, side: 3, size: 55,
      values: (u, vals) => vals.map((v) => Math.round(v)) },
    { scale: 't', stroke: '#f2495c', grid: { show: false }, ticks: { stroke: '#2c3235' }, side: 1, size: 45,
      values: (u, vals) => vals.map((v) => Number(v).toFixed(0) + '°') },
    { scale: 'w10', stroke: '#ff9830', grid: { show: false }, ticks: { stroke: '#2c3235' }, side: 1, size: 45,
      values: (u, vals) => vals.map((v) => Number(v).toFixed(0)) },
    { scale: 'pct', stroke: '#b3d4ff', grid: { show: false }, ticks: { stroke: '#2c3235' }, side: 1, size: 45,
      values: (u, vals) => vals.map((v) => Number(v).toFixed(0) + '%') },
  ];
  if (wPlot) { wPlot.destroy(); wPlot = null; }
  wPlot = new uPlot(opts, [tX, real, fcW, temp, wind, gusts, cloud, precipP], $('wchart24'));

  renderLegendTable($('wlegend24'), [
    { label: 'PV Ist', color: '#5794f2', values: real, fmt: fmtW },
    { label: 'PV Prognose', color: '#73bf69', values: fcW, fmt: fmtW },
    { label: 'Temp', color: '#f2495c', values: temp, fmt: (v) => v == null ? '–' : v.toFixed(0) + ' °C' },
    { label: 'Wind/Böen', color: '#ff9830', values: gusts, fmt: (v) => v == null ? '–' : v.toFixed(0) + ' km/h' },
    { label: 'Bewölkung', color: '#b3d4ff', values: cloud, fmt: (v) => v == null ? '–' : v.toFixed(0) + ' %' },
  ], ['Min', 'Mean', 'Max']);
}

function fmtW(v) {
  if (v == null) return '–';
  return Math.round(v) + ' W';
}

/* --- 7-Tage-Kacheln --- */
function updateTiles(w) {
  const today = new Date().toISOString().slice(0, 10);
  const dirArrow = (deg) => {
    if (deg == null) return '';
    const dirs = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(deg / 45) % 8];
  };
  const tiles = w.daily.map((d) => {
    const dt = new Date(d.date + 'T12:00:00');
    const label = dt.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
    const kwhCls = d.kwh >= 4 ? 'good' : d.kwh >= 1.5 ? 'mid' : 'poor';
    return `<div class="fc-day w-day">
      <div class="fc-datel">${label}${d.date === today ? ' (heute)' : ''}</div>
      <div class="fc-kwh ${kwhCls}">${d.kwh.toFixed(2)} kWh</div>
      <div class="w-row">☀ ${d.sun_h == null ? '–' : d.sun_h + ' h'} · UV ${d.uv_max ?? '–'}</div>
      <div class="w-row">☁ ${d.cloud ?? '–'} % · 🌧 ${d.prec_mm ?? '–'} mm / ${d.prec_prob ?? '–'} %</div>
      <div class="w-row">💨 ${d.wind ?? '–'} / ${d.gust ?? '–'} km/h ${dirArrow(d.dir ?? null)}</div>
      <div class="w-row">🌡 ${d.tmin ?? '–'}–${d.tmax ?? '–'} °C</div>
      <div class="w-row">👁 ${d.vis ?? '–'} km · 💧 ${d.rh ?? '–'} %</div>
      <div class="w-row dim">🌅 ${d.sunrise} – ${d.sunset}</div>
    </div>`;
  }).join('');
  $('wtiles').innerHTML = tiles;
}

async function load() {
  const status = $('status');
  try {
    status.textContent = 'lade…';
    const w = await fetchJSON('/weather');
    $('w-headline').textContent =
      `Wetter – ${w.ort || ''} · 15 Tage Daten · Update ${new Date(w.fetched_at * 1000).toLocaleTimeString('de-DE')}`;
    await update24(w);
    updateTiles(w);
    status.textContent = 'Daten OK';
    status.classList.remove('err');
  } catch (e) {
    status.textContent = 'FEHLER: ' + (e.message || e);
    status.classList.add('err');
  }
}

load();
setInterval(load, 30 * 60000);
window.addEventListener('resize', () => load());
