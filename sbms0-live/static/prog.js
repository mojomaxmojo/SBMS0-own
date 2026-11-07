/* SBMS0 PROGNOSE – 7-Tage-PV-Ertrag (Open-Meteo via /forecast) */
'use strict';

let fcPlot = null, fcDaysPlot = null;

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
    const [cfg, fc] = await Promise.all([fetchJSON('/pvconfig'), fetchJSON('/forecast')]);
    if (fc.error) throw new Error(fc.error);

    $('pv-headline').textContent =
      `PV-Prognose (${fc.daily.length} Tage) – ${cfg.ort || ''} · ${fc.kwp} kWp · ${fc.tilt}° Neigung`;
    $('fc-src-hint').textContent =
      'Open-Meteo · P = kWp × Strahlung × ' + fc.pr.toFixed(2) + ' (Performance-Ratio)';

    /* Chart: stündliche Watt-Werte */
    const times = fc.times.map((t) => new Date(t.replace(' ', 'T')).getTime());
    const data = [[], []];
    for (let i = 0; i < times.length; i++) {
      data[0].push(times[i]);
      data[1].push(fc.watts[i] == null ? null : Number(fc.watts[i]));
    }
    const opts = uplotBaseOpts(300, (u, vals) => vals.map((v) => Math.round(v) + ' W'));
    opts.width = $('fcchart').clientWidth;
    opts.legend = { show: false };
    opts.cursor = { x: true, y: false, points: { show: false } };
    opts.series = [
      {},
      { label: 'Theoretischer Ertrag', stroke: '#73bf69', width: 1.5,
        fill: 'rgba(115,191,105,0.15)', spanGaps: true },
    ];
    opts.axes = [
      { stroke: '#8e8e8e', grid: { stroke: '#2c3235' }, ticks: { stroke: '#2c3235' },
        values: (u, vals) => vals.map((v) => {
          const d = new Date(v);
          return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' +
            d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        }) },
      { stroke: '#73bf69', grid: { stroke: '#2c3235' }, ticks: { stroke: '#2c3235' }, side: 3, size: 55,
        values: (u, vals) => vals.map((v) => Math.round(v)) },
    ];
    if (fcPlot) { fcPlot.destroy(); fcPlot = null; }
    new uPlot(opts, data, $('fcchart'));

    /* Tages-Balkendiagramm mit kWh-Zahl über jedem Balken */    const dTimes = fc.daily.map((d) => new Date(d.date + 'T12:00:00').getTime());
    const dKwh = fc.daily.map((d) => Number(d.kwh));
    const dMax = Math.max(1, ...dKwh) * 1.2;
    const dayOpts = uplotBaseOpts(240, (u, vals) => vals.map((v) => Number(v).toFixed(0)));
    dayOpts.width = $('fcchartdays').clientWidth;
    dayOpts.legend = { show: false };
    dayOpts.cursor = { x: true, y: false, points: { show: false } };
    dayOpts.scales = { x: { time: true }, kwhd: { auto: false, range: [0, dMax] } };
    dayOpts.series = [
      {},
      { label: 'kWh', show: false, scale: 'kwhd' },
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
          const w = Math.max(4, Math.min(step * 0.6, 80));
          const y0 = u.valToPos(0, 'kwhd', true);
          ctx.save();
          for (let i = 0; i < n; i++) {
            const v = u.data[1][i];
            if (v == null) continue;
            const x = u.valToPos(u.data[0][i], 'x', true);
            const y = u.valToPos(v, 'kwhd', true);
            ctx.fillStyle = 'rgba(115,191,105,0.75)';
            ctx.fillRect(x - w / 2, y, w, Math.max(1, y0 - y));
            // kWh-Zahl über dem Balken
            ctx.fillStyle = v >= 8 ? '#73bf69' : v >= 4 ? '#f2cc0c' : '#ff9830';
            ctx.font = 'bold 12px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(v.toFixed(2), x, y - 4);
          }
          ctx.restore();
        },
      ],
    };
    if (fcDaysPlot) { fcDaysPlot.destroy(); fcDaysPlot = null; }
    fcDaysPlot = new uPlot(dayOpts, [dTimes, dKwh], $('fcchartdays'));

    renderLegendTable($('fclegend'), [
      { label: 'Theoretischer Ertrag', color: '#73bf69', values: data[1], fmt: fmtWFC },
    ], ['Min', 'Mean', 'Max']);

    status.textContent = 'Daten OK';
    status.classList.remove('err');
  } catch (e) {
    status.textContent = 'FEHLER: ' + (e.message || e);
    status.classList.add('err');
    $('fcchartdays').innerHTML = `<span class="err-ts">Prognose-Fehler: ${e.message || e}</span>`;
  }

  /* --- Ist vs. Prognose (letzte 7 Tage) --- */
  try {
    const cmp = await fetchJSON('/pvcompare');
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

function fmtWFC(v) {
  if (v == null) return '–';
  const a = Math.abs(v);
  if (a >= 1000) return (v / 1000).toFixed(2) + ' kW';
  return v.toFixed(0) + ' W';
}

load();
loadRain();
setInterval(load, 30 * 60000);  // alle 30 min (Server-Cache ist auch 30 min)
setInterval(loadRain, 6 * 3600000);
window.addEventListener('resize', () => load());
