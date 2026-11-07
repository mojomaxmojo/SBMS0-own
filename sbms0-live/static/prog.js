/* SBMS0 PROGNOSE – 7-Tage-PV-Ertrag (Open-Meteo via /forecast) */
'use strict';

let fcDaysPlot = null;

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) {
    let msg = 'HTTP ' + r.status;
    try { msg = (await r.json()).error || msg; } catch (e) { /* egal */ }
    throw new Error(msg);
  }
  return await r.json();
}

/* Tick/Uhr wie auf anderen Seiten */
setInterval(() => {
  const c = $('clock');
  if (c) c.textContent = new Date().toLocaleTimeString('de-DE');
}, 1000);

async function load() {
  const status = $('status');
  try {
    status.textContent = 'lade…';
    const [cfg, fc, cmp] = await Promise.all([
      fetchJSON('/pvconfig'), fetchJSON('/forecast'), fetchJSON('/pvcompare'),
    ]);
    if (fc.error) throw new Error(fc.error);

    $('pv-headline').textContent =
      `PV-Prognose (${fc.daily.length} Tage) – ${cfg.ort || ''} · ${fc.kwp} kWp · ${fc.tilt}° Neigung · ` +
      `Open-Meteo · P = kWp × Strahlung × ${fc.pr.toFixed(2)}`;

    /* Tages-Balkendiagramm: Prognose + Real nebeneinander, kWh-Zahl oben */
    const realByDate = {};
    if (cmp && cmp.days) {
      for (const d of cmp.days) if (d.real != null) realByDate[d.date] = Number(d.real);
    }
    const dTimes = fc.daily.map((d) => new Date(d.date + 'T12:00:00').getTime());
    const dKwh = fc.daily.map((d) => Number(d.kwh));
    const dReal = fc.daily.map((d) => realByDate[d.date] != null ? Number(realByDate[d.date]) : null);
    const dMax = Math.max(1, ...dKwh, ...dReal.filter((v) => v != null)) * 1.2;
    const dayOpts = uplotBaseOpts(240, (u, vals) => vals.map((v) => Number(v).toFixed(0)));
    dayOpts.width = $('fcchartdays').clientWidth;
    dayOpts.legend = { show: false };
    dayOpts.cursor = { x: true, y: false, points: { show: false } };
    dayOpts.scales = { x: { time: true }, kwhd: { auto: false, range: [0, dMax] } };
    dayOpts.series = [
      {},
      { label: 'Prognose', show: false, scale: 'kwhd' },
      { label: 'Real', show: false, scale: 'kwhd' },
    ];
    dayOpts.axes = [
      { stroke: '#8e8e8e', grid: { stroke: '#2c3235' }, ticks: { stroke: '#2c3235' },
        values: (u, vals) => vals.map((v) => new Date(v).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })) },
      { scale: 'kwhd', stroke: '#8e8e8e', grid: { stroke: '#2c3235' }, ticks: { stroke: '#2c3235' }, side: 3, size: 55,
        values: (u, vals) => vals.map((v) => Number(v).toFixed(0)) },
    ];
    dayOpts.hooks = {
      draw: [
        (u) => {
          const ctx = u.ctx;
          const n = u.data[0].length;
          if (n < 1) return;
          const step = n > 1
            ? Math.abs(u.valToPos(u.data[0][1], 'x', true) - u.valToPos(u.data[0][0], 'x', true))
            : u.bbox.w;
          const w = Math.max(3, Math.min(step * 0.28, 50));  // Balkenbreite (2 Balken + Lücke)
          const y0 = u.valToPos(0, 'kwhd', true);
          ctx.save();
          for (let i = 0; i < n; i++) {
            const x = u.valToPos(u.data[0][i], 'x', true);
            const fcV = u.data[1][i], reV = u.data[2][i];
            ctx.font = 'bold 11px system-ui, sans-serif';
            ctx.textAlign = 'center';
            // Prognose-Balken (links, grün)
            if (fcV != null) {
              const y = u.valToPos(fcV, 'kwhd', true);
              ctx.fillStyle = 'rgba(115,191,105,0.75)';
              ctx.fillRect(x - w - 1, y, w, Math.max(1, y0 - y));
              ctx.fillStyle = '#73bf69';
              ctx.fillText(fcV.toFixed(2), x - w / 2 - 1, y - 4);
            }
            // Real-Balken (rechts, blau)
            if (reV != null) {
              const y = u.valToPos(reV, 'kwhd', true);
              ctx.fillStyle = 'rgba(87,148,242,0.75)';
              ctx.fillRect(x + 1, y, w, Math.max(1, y0 - y));
              ctx.fillStyle = '#5794f2';
              ctx.fillText(reV.toFixed(2), x + w / 2 + 1, y - 4);
            }
          }
          ctx.restore();
        },
      ],
    };
    if (fcDaysPlot) { fcDaysPlot.destroy(); fcDaysPlot = null; }
    fcDaysPlot = new uPlot(dayOpts, [dTimes, dKwh, dReal], $('fcchartdays'));
    $('fcbarlegend').innerHTML =
      '<span class="lg-dot" style="background:#73bf69"></span> Prognose &nbsp;&nbsp;' +
      '<span class="lg-dot" style="background:#5794f2"></span> Real (InfluxDB) — nur vergangene/aktuelle Tage';

    status.textContent = 'Daten OK';
    status.classList.remove('err');
  } catch (e) {
    status.textContent = 'FEHLER: ' + (e.message || e);
    status.classList.add('err');
    $('fcchartdays').innerHTML = `<span class="err-ts">Prognose-Fehler: ${e.message || e}</span>`;
  }

  /* --- Rückblick letzte 7 Tage (unten) --- */
  try {
    await loadPast(cmp, cmp.pr);
  } catch (e) { /* still */ }

  /* --- Ist vs. Prognose (letzte 7 Tage) --- */
  try {
    if (cmp.error) throw new Error(cmp.error);
    $('cmp-hint').textContent = `PR ${cmp.pr.toFixed(2)} · Zeitzone ${cmp.timezone}`;
    let html = '<table class="legend-table"><tr><th>Tag</th><th>Prognose</th><th>Real (Influx)</th><th>Abw.</th></tr>';
    let sumF = 0, sumR = 0, n = 0;
    for (const d of cmp.days) {
      const dt = new Date(d.date + 'T12:00:00');
      const label = dt.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
      const real = d.real == null ? '–' : d.real.toFixed(2) + ' kWh';
      const diff = d.diff_pct == null ? '–'
        : `<span style="color:${d.diff_pct >= 0 ? 'var(--green)' : 'var(--red)'}">${d.diff_pct > 0 ? '+' : ''}${d.diff_pct}%</span>`;
      html += `<tr><td>${label}</td><td>${d.forecast.toFixed(2)} kWh</td><td>${real}</td><td>${diff}</td></tr>`;
      if (d.real != null) { sumF += d.forecast; sumR += d.real; n++; }
    }
    html += '</table>';
    if (n > 0) {
      const dev = ((sumR - sumF) / sumF * 100).toFixed(0);
      const color = dev >= 0 ? 'var(--green)' : 'var(--red)';
      html += `<div class="dim" style="padding:4px 2px">Summe 7 Tage: Prognose <b>${sumF.toFixed(1)} kWh</b> · ` +
        `Real <b>${sumR.toFixed(1)} kWh</b> · Abweichung <b style="color:${color}">${dev > 0 ? '+' : ''}${dev}%</b>` +
        ` → <span class="dim">pv.json: performance_ratio ${cmp.pr.toFixed(2)} ${dev < -5 ? 'senken' : dev > 5 ? 'erhöhen' : 'passt'}</span></div>`;
    }
    $('cmp-table').innerHTML = html;
  } catch (e) {
    $('cmp-table').innerHTML = `<span class="err-ts">Vergleich-Fehler: ${e.message || e}</span>`;
  }
}

/* — Rückblick letzte 7 Tage: kalibrierte Prognose vs. Real (Balkenpaare) — */
let fcPastPlot = null;

function drawBarPairs(u, colors) {
  // u.data: [x, vA, vB]; zeichnet je Tag zwei Balken mit Zahlen
  const ctx = u.ctx;
  const n = u.data[0].length;
  if (n < 1) return;
  const step = n > 1
    ? Math.abs(u.valToPos(u.data[0][1], 'x', true) - u.valToPos(u.data[0][0], 'x', true))
    : u.bbox.w;
  const w = Math.max(3, Math.min(step * 0.28, 50));
  const y0 = u.valToPos(0, 'kwhd', true);
  ctx.save();
  for (let i = 0; i < n; i++) {
    const x = u.valToPos(u.data[0][i], 'x', true);
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const a = u.data[1][i], b = u.data[2][i];
    if (a != null) {
      const y = u.valToPos(a, 'kwhd', true);
      ctx.fillStyle = colors.aFill;
      ctx.fillRect(x - w - 1, y, w, Math.max(1, y0 - y));
      ctx.fillStyle = colors.aText;
      ctx.fillText(a.toFixed(2), x - w / 2 - 1, y - 4);
    }
    if (b != null) {
      const y = u.valToPos(b, 'kwhd', true);
      ctx.fillStyle = colors.bFill;
      ctx.fillRect(x + 1, y, w, Math.max(1, y0 - y));
      ctx.fillStyle = colors.bText;
      ctx.fillText(b.toFixed(2), x + w / 2 + 1, y - 4);
    }
  }
  ctx.restore();
}

async function loadPast(cmp, pr) {
  const days = (cmp.days || []).slice(-8);
  const times = days.map((d) => new Date(d.date + 'T12:00:00').getTime());
  const fcV = days.map((d) => Number(d.forecast));
  const reV = days.map((d) => d.real == null ? null : Number(d.real));
  const maxV = Math.max(1, ...fcV, ...reV.filter((v) => v != null)) * 1.2;

  const opts = uplotBaseOpts(220, (u, vals) => vals.map((v) => Number(v).toFixed(0)));
  opts.width = $('fcpastchart').clientWidth;
  opts.legend = { show: false };
  opts.cursor = { x: true, y: false, points: { show: false } };
  opts.scales = { x: { time: true }, kwhd: { auto: false, range: [0, maxV] } };
  opts.series = [
    {},
    { label: 'Prognose', show: false, scale: 'kwhd' },
    { label: 'Real', show: false, scale: 'kwhd' },
  ];
  opts.axes = [
    { stroke: '#8e8e8e', grid: { stroke: '#2c3235' }, ticks: { stroke: '#2c3235' },
      values: (u, vals) => vals.map((v) => new Date(v).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })) },
    { scale: 'kwhd', stroke: '#8e8e8e', grid: { stroke: '#2c3235' }, ticks: { stroke: '#2c3235' }, side: 3, size: 55,
      values: (u, vals) => vals.map((v) => Number(v).toFixed(0)) },
  ];
  opts.hooks = { draw: [drawBarPairs] };
  if (fcPastPlot) { fcPastPlot.destroy(); fcPastPlot = null; }
  try {
    fcPastPlot = new uPlot(opts, [times, fcV, reV], $('fcpastchart'));
  } catch (e) {
    $('fcpastchart').innerHTML = '<span class="err-ts">Chart-Fehler: ' + (e.message || e) + '</span>';
  }
  $('pr-hint').textContent = pr.toFixed(2);
}

/* --- Reinigungs-Hinweis --- */
async function loadRain() {
  try {
    const rn = await fetchJSON('/rain');
    const el = $('clean-status'), de = $('clean-detail');
    const color = rn.status === 'ok' ? 'var(--green)'
      : rn.status === 'soon' ? '#f2cc0c' : rn.status === 'due' ? 'var(--red)' : 'var(--dim)';
    const icon = rn.status === 'ok' ? '✓' : rn.status === 'soon' ? '⏳' : rn.status === 'due' ? '💧' : '–';
    el.textContent = `${icon} ${rn.text}`;
    el.style.color = color;
    const parts = [];
    if (rn.last_rain) parts.push(`letzter Waschregen (≥5 mm): ${rn.last_rain}`);
    if (rn.last_cleaned) parts.push(`letzte Reinigung: ${rn.last_cleaned}`);
    parts.push(`Regen 7 Tage: ${rn.rain_mm_7d} mm`);
    de.textContent = parts.join(' · ') + ' · nach Reinigung Datum in pv.json (last_cleaned) eintragen';
  } catch (e) {
    $('clean-status').textContent = '–';
    $('clean-detail').textContent = 'Reinigungs-Hinweis nicht verfügbar';
  }
}


load();
loadRain();
setInterval(load, 30 * 60000);  // alle 30 min (Server-Cache ist auch 30 min)
setInterval(loadRain, 6 * 3600000);
window.addEventListener('resize', () => load());
