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

/* --- 24-h-Verlauf: stündliches Wetter (keine PV - die ist auf PROGNOSE) --- */
let wPlot = null;

async function update24(w) {
  // Fenster: ab jetzt +24 h
  const now = Date.now();
  const times = w.times.map((t) => new Date(t.replace(' ', 'T')).getTime());
  let i0 = 0;
  for (let i = 0; i < times.length; i++) {
    if (times[i] >= now) { i0 = i; break; }
  }
  let i1 = times.length - 1;
  for (let i = times.length - 1; i >= 0; i--) {
    if (times[i] <= now + 24 * 3600e3) { i1 = i; break; }
  }
  const slice = (arr) => arr.slice(i0, i1 + 1);
  const tX = slice(times);
  const temp = slice(w.hourly.temp).map((v) => v == null ? null : Number(v));
  const rh = slice(w.hourly.rh).map((v) => v == null ? null : Number(v));
  const wind = slice(w.hourly.wind).map((v) => v == null ? null : Number(v));
  const gusts = slice(w.hourly.gusts).map((v) => v == null ? null : Number(v));
  const cloud = slice(w.hourly.cloud).map((v) => v == null ? null : Number(v));
  const precip = slice(w.hourly.precip).map((v) => v == null ? null : Number(v));
  const precipP = slice(w.hourly.precip_prob).map((v) => v == null ? null : Number(v));
  const uv = slice(w.hourly.uv).map((v) => v == null ? null : Number(v));

  const opts = uplotBaseOpts(300, (u, vals) => vals.map((v) => Number(v).toFixed(0)));
  opts.width = $('wchart24').clientWidth;
  opts.legend = { show: false };
  opts.cursor = { x: true, y: false, points: { show: false } };
  opts.series = [
    {},
    { label: 'Temp (°C)', stroke: '#f2495c', width: 2, scale: 't', spanGaps: true, points: { show: false } },
    { label: 'Wind (km/h)', stroke: '#ff9830', width: 1.5, scale: 'w10', spanGaps: true, points: { show: false } },
    { label: 'Böen (km/h)', stroke: '#ff9830', width: 1, scale: 'w10', spanGaps: true, dash: [4, 3], points: { show: false } },
    { label: 'Bewölkung (%)', stroke: '#b3d4ff', width: 1.5, scale: 'pct', spanGaps: true, points: { show: false } },
    { label: 'Regen-Wahr. (%)', stroke: '#5794f2', width: 1.5, scale: 'pct', spanGaps: true, dash: [2, 3], points: { show: false } },
    { label: 'Regen (mm/h)', stroke: '#5794f2', width: 0, scale: 'mm', spanGaps: true,
      fill: 'rgba(87,148,242,0.25)', points: { show: false } },
    { label: 'UV', stroke: '#f2cc0c', width: 1.5, scale: 'uv', spanGaps: true, points: { show: false } },
    { label: 'Feuchte (%)', stroke: '#8ab8ff', width: 1, scale: 'pct', spanGaps: true, dash: [2, 3], points: { show: false } },
  ];
  const maxPrec = Math.max(1, ...precip.filter((v) => v != null));
  const maxWind = Math.max(30, ...gusts.filter((v) => v != null), 0) * 1.15;
  opts.scales = { x: { time: true },
    t: { auto: true },
    w10: { auto: false, range: [0, maxWind] },
    pct: { auto: false, range: [0, 100] },
    mm: { auto: false, range: [0, maxPrec * 1.2] },
    uv: { auto: false, range: [0, 12] } };
  opts.axes = [
    { stroke: '#8e8e8e', grid: { stroke: '#2c3235' }, ticks: { stroke: '#2c3235' },
      values: (u, vals) => vals.map((v) => {
        const d = new Date(v);
        return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' +
          d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      }) },
    { scale: 't', stroke: '#f2495c', grid: { stroke: '#2c3235' }, ticks: { stroke: '#2c3235' }, side: 3, size: 45,
      values: (u, vals) => vals.map((v) => Number(v).toFixed(0) + '°') },
    { scale: 'w10', stroke: '#ff9830', grid: { show: false }, ticks: { stroke: '#2c3235' }, side: 1, size: 45,
      values: (u, vals) => vals.map((v) => Number(v).toFixed(0)) },
    { scale: 'pct', stroke: '#b3d4ff', grid: { show: false }, ticks: { stroke: '#2c3235' }, side: 1, size: 45,
      values: (u, vals) => vals.map((v) => Number(v).toFixed(0) + '%') },
    { scale: 'uv', stroke: '#f2cc0c', grid: { show: false }, ticks: { stroke: '#2c3235' }, side: 3, size: 40,
      values: (u, vals) => vals.map((v) => Number(v).toFixed(0)) },
  ];
  if (wPlot) { wPlot.destroy(); wPlot = null; }
  wPlot = new uPlot(opts, [tX, temp, wind, gusts, cloud, precipP, precip, uv, rh], $('wchart24'));

  renderLegendTable($('wlegend24'), [
    { label: 'Temp', color: '#f2495c', values: temp, fmt: (v) => v == null ? '–' : v.toFixed(1) + ' °C' },
    { label: 'Wind/Böen', color: '#ff9830', values: gusts, fmt: (v) => v == null ? '–' : v.toFixed(0) + ' km/h' },
    { label: 'Bewölkung', color: '#b3d4ff', values: cloud, fmt: (v) => v == null ? '–' : v.toFixed(0) + ' %' },
    { label: 'Regen mm', color: '#5794f2', values: precip, fmt: (v) => v == null ? '–' : v.toFixed(1) + ' mm' },
    { label: 'UV', color: '#f2cc0c', values: uv, fmt: (v) => v == null ? '–' : v.toFixed(1) },
    { label: 'Feuchte', color: '#8ab8ff', values: rh, fmt: (v) => v == null ? '–' : v.toFixed(0) + ' %' },
  ], ['Min', 'Mean', 'Max']);
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
