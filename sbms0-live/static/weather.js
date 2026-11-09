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

/* WMO-Wettercodes -> Icon (95/96/99 = Gewitter) */
function wmoIcon(c) {
  if (c == null) return '';
  c = Number(c);
  if (c === 0) return '☀️';
  if (c <= 2) return '🌤️';
  if (c === 3) return '☁️';
  if (c === 45 || c === 48) return '🌫️';
  if (c >= 51 && c <= 57) return '🌦️';
  if (c >= 61 && c <= 67) return '🌧️';
  if (c >= 71 && c <= 77) return '🌨️';
  if (c >= 80 && c <= 82) return '🌦️';
  if (c >= 85 && c <= 86) return '🌨️';
  if (c >= 95) return '⛈️';
  return '';
}

function wmoText(c) {
  if (c == null) return '';
  c = Number(c);
  if (c === 0) return 'Klar';
  if (c === 1) return 'Überw. klar';
  if (c === 2) return 'Heiter';
  if (c === 3) return 'Bedeckt';
  if (c === 45 || c === 48) return 'Nebel';
  if (c === 51 || c === 53 || c === 55) return 'Niesel';
  if (c === 56 || c === 57) return 'Gefr. Niesel';
  if (c === 61) return 'Leichter Regen';
  if (c === 63) return 'Regen';
  if (c === 65) return 'Starker Regen';
  if (c === 66 || c === 67) return 'Gefr. Regen';
  if (c === 71) return 'Leichter Schnee';
  if (c === 73) return 'Schnee';
  if (c === 75) return 'Starker Schnee';
  if (c === 77) return 'Schneegriesel';
  if (c === 80) return 'Leichte Schauer';
  if (c === 81) return 'Schauer';
  if (c === 82) return 'Heftige Schauer';
  if (c === 85 || c === 86) return 'Schneeschauer';
  if (c === 95) return 'Gewitter';
  if (c === 96) return 'Gewitter + Hagel';
  if (c === 99) return 'Schw. Gewitter + Hagel';
  return 'Wetter ' + c;
}

/* --- 24 h: stündliche Kacheln ab aktueller Stunde (kein Diagramm) --- */
async function update24(w) {
  const now = Date.now();
  const times = w.times.map((t) => new Date(t.replace(' ', 'T')).getTime());
  // Aktuelle Stunde = erster Index (t <= now < t+1h) -> immer links
  let i0 = 0;
  for (let i = 0; i < times.length; i++) {
    if (times[i] <= now && now < times[i] + 3600e3) { i0 = i; break; }
    if (times[i] > now) { i0 = i; break; }
  }
  const i1 = Math.min(times.length - 1, i0 + 23);
  const pModels = w.hourly.precip_models || [];
  const medianOf = (getVal, i, fallback) => {
    const nums = pModels.map((m) => getVal(m, i)).filter((v) => v != null).map(Number);
    if (!nums.length) return fallback(i);
    const srt = nums.slice().sort((a, b) => a - b);
    const mid = Math.floor(srt.length / 2);
    return srt.length % 2 ? srt[mid] : (srt[mid - 1] + srt[mid]) / 2;
  };
  // Median über ALLE Modelle (dwd_icon wieder dabei). Kein HARMONIE-
  // Vorzug mehr: Warnungen und Anzeige folgen konsequent dem Median.
  const medianPrec = (i) => medianOf((m, j) => m.prec ? m.prec[j] : null, i, (j) => w.hourly.precip[j]);
  const medianWind = (i) => medianOf((m, j) => m.wind ? m.wind[j] : null, i, (j) => w.hourly.wind[j]);
  const medianGust = (i) => medianOf((m, j) => m.gust ? m.gust[j] : null, i, (j) => w.hourly.gusts[j]);
  const hours = [];
  for (let i = i0; i <= i1; i++) {
    // Min / Median / Max der Boen je Stunde über alle Modelle
    const gv = pModels.map((m) => m.gust ? m.gust[i] : null).filter((v) => v != null).map(Number);
    const gMin = gv.length ? Math.min(...gv) : null;
    const gMax = gv.length ? Math.max(...gv) : null;
    const gMed = medianGust(i);
    const wVal = medianWind(i);
    hours.push({
      t: times[i],
      label: new Date(times[i]).toLocaleDateString('de-DE', { weekday: 'short' }) + ' ' +
        new Date(times[i]).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + '–' +
        new Date(times[i] + 3600e3).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
      day: new Date(times[i]).toLocaleDateString('de-DE', { weekday: 'short' }),
      temp: w.hourly.temp[i], wind: wVal, gust: gMed,
      gMin, gMed, gMax,
      cloud: w.hourly.cloud[i], prec: medianPrec(i), precP: w.hourly.precip_prob[i],
      uv: w.hourly.uv[i], rh: w.hourly.rh[i], vis: w.hourly.vis_km[i],
      wmo: w.hourly.wmo ? w.hourly.wmo[i] : null,
      wtxt: wmoText(w.hourly.wmo ? w.hourly.wmo[i] : null),
      metT: (w.hourly.met && w.hourly.met.temp) ? w.hourly.met.temp[i] : null,
      metW: (w.hourly.met && w.hourly.met.wind) ? w.hourly.met.wind[i] : null,
      metP: (w.hourly.met && w.hourly.met.prec) ? w.hourly.met.prec[i] : null,
    });
  }
  const warnGustHourly = Number(w.warn_gust_hourly || 60);
  const isNow = (t) => t <= now && now < t + 3600e3;
  const tiles = hours.map((h) => {
    const nowCls = isNow(h.t) ? ' now' : '';
    const precCls = (h.prec != null && h.prec > 0) ? ' rain' : '';
    // Oranger Rahmen: MEDIAN-Boen der Stunde über der Schwelle (pv.json warn_gust_hourly_kmh)
    const gustCls = (warnGustHourly > 0 && h.gMed != null && Number(h.gMed) >= warnGustHourly) ? ' gust-warn' : '';
    const gustDisp = (h.gMin != null && h.gMax != null)
      ? `${h.gMin.toFixed(0)}–<span class="med">${h.gMed == null ? '–' : Number(h.gMed).toFixed(0)}</span>–${h.gMax.toFixed(0)}`
      : `${h.wind == null ? '–' : Number(h.wind).toFixed(0)} / ${h.gust == null ? '–' : Number(h.gust).toFixed(0)}`;
    return `<div class="h-hour${nowCls}${precCls}${gustCls}">
      <div class="h-time">${wmoIcon(h.wmo)} ${h.label}</div>
      ${h.wtxt ? `<div class="h-wtxt">${h.wtxt}</div>` : ''}
      <div class="h-temp">🌡 ${h.temp == null ? '–' : Number(h.temp).toFixed(0)}°C</div>
      <div class="h-row">💨 ${gustDisp}</div>
      <div class="h-row">☁ ${h.cloud == null ? '–' : Number(h.cloud).toFixed(0)} %</div>
      <div class="h-row">🌧 ${h.prec == null ? '–' : Number(h.prec).toFixed(1)} mm / ${h.precP == null ? '–' : Number(h.precP).toFixed(0)} %</div>
      <div class="h-row">☀ UV ${h.uv == null ? '–' : Number(h.uv).toFixed(0)}</div>
      <div class="h-row">💧 ${h.rh == null ? '–' : Number(h.rh).toFixed(0)} % · 👁 ${h.vis == null ? '–' : Number(h.vis).toFixed(0)} km</div>
      ${(h.metT != null || h.metW != null || h.metP != null)
        ? `<div class="h-row dim">MET 🌡 ${h.metT == null ? '–' : Number(h.metT).toFixed(0)}° · 💨 ${h.metW == null ? '–' : Number(h.metW).toFixed(0)} · 🌧 ${h.metP == null ? '–' : Number(h.metP).toFixed(1)}</div>`
        : ''}
    </div>`;
  }).join('');
  $('whours').innerHTML = tiles;
}

/* --- 24-h-Chart: Median-Kurven Wind / Böen (km/h, links) + Niederschlag (mm, rechts) --- */
let wetterPlot = null;

function updateChart24(w) {
  const now = Date.now();
  const times = w.times.map((t) => new Date(t.replace(' ', 'T')).getTime());
  let i0 = 0;
  for (let i = 0; i < times.length; i++) {
    if (times[i] <= now && now < times[i] + 3600e3) { i0 = i; break; }
    if (times[i] > now) { i0 = i; break; }
  }
  const i1 = Math.min(times.length - 1, i0 + 23);
  const med = w.hourly.med || { precip: [], wind: [], gusts: [] };
  const data = [[], [], [], []];
  for (let i = i0; i <= i1; i++) {
    data[0].push(times[i]);
    data[1].push(med.wind[i] == null ? null : Number(med.wind[i]));
    data[2].push(med.gusts[i] == null ? null : Number(med.gusts[i]));
    data[3].push(med.precip[i] == null ? null : Number(med.precip[i]));
  }
  const opts = uplotBaseOpts(240,
    (u, vals) => vals.map((v) => Math.round(v)));   // links: km/h
  opts.width = $('wchart').clientWidth;
  opts.legend = { show: true, live: true };
  opts.cursor = { x: true, y: false, points: { show: false } };
  opts.series = [
    {},
    { label: 'Wind (Median)', stroke: '#b3d4ff', width: 1.5,
      fill: 'rgba(179,212,255,0.10)', spanGaps: true },
    { label: 'Böen (Median)', stroke: '#ff9830', width: 2, spanGaps: true },
    { label: 'Niederschlag (Median)', stroke: '#5794f2', width: 2, scale: 'mm',
      spanGaps: true, fill: 'rgba(87,148,242,0.12)' },
  ];
  opts.scales = { x: { time: true },
    mm: { auto: true, range: (u, dmin, dmax) => [0, Math.max(1, Math.ceil((dmax || 1) * 1.2))] } };
  opts.axes.push({ scale: 'mm', stroke: '#5794f2', grid: { show: false },
    ticks: { stroke: '#2c3235' }, side: 1, size: 55,
    values: (u, vals) => vals.map((v) => Number(v).toFixed(0) + ' mm') });
  if (!wetterPlot) wetterPlot = new uPlot(opts, data, $('wchart'));
  else { wetterPlot.scales = opts.scales; wetterPlot.setData(data); }
}

/* --- 7-Tage-Kacheln: nur heute + Zukunft, auf Breite verteilt --- */
async function updateTiles(w, tides) {
  const today = new Date().toISOString().slice(0, 10);
  const days = w.daily.filter((d) => d.date >= today);
  const warnGust = Number(w.warn_gust || 60);
  const warnRain = Number(w.warn_rain_mm || 20);
  const tideDaily = (tides && tides.daily) || {};

  // Anzeige Min–Median–Max, Median hell/fett (class "med").
  // Einzelwert-Fallback (nur Median vorhanden) ohne Spanne.
  const km = (v) => v == null ? '–' : Number(v).toFixed(0);
  const km1 = (v) => v == null ? '–' : Number(v).toFixed(1);
  const range3 = (min, med, max, unit, fmt) => {
    if (min == null || max == null) return `${fmt(med)}${unit}`;
    return `${fmt(min)}–<span class="med">${fmt(med)}</span>–${fmt(max)}${unit}`;
  };

  const tiles = days.map((d) => {
    // Median = EINZIGE Grundlage für die Unwetter-Warnung (Sicherheit/Ehrlichkeit:
    // weder Max-Optimismus noch Einzelmodell-Panik)
    const gustMed = d.gust_med != null ? Number(d.gust_med)
      : (d.gust_harm != null ? Number(d.gust_harm) : (d.gust != null ? Number(d.gust) : null));
    const gustMin = d.gust_min != null ? Number(d.gust_min) : null;
    const gustMax = d.gust_max != null ? Number(d.gust_max) : null;
    const precMed = d.prec_med != null ? Number(d.prec_med)
      : (d.prec_mm != null ? Number(d.prec_mm) : null);
    const precMin = d.prec_min != null ? Number(d.prec_min) : null;
    const precMax = d.prec_max != null ? Number(d.prec_max) : null;
    const windMed = d.wind_med != null ? Number(d.wind_med)
      : (d.wind_harm != null ? Number(d.wind_harm) : (d.wind != null ? Number(d.wind) : null));

    const triggers = [];
    if (gustMed != null && gustMed >= warnGust)
      triggers.push(`Böen bis ${Number(gustMed).toFixed(0)} km/h (Median)`);
    if (precMed != null && precMed >= warnRain)
      triggers.push(`Regen bis ${Number(precMed).toFixed(0)} mm (Median)`);
    const warn = triggers.length > 0;
    const warnText = warn ? `⚠ UNWETTER: ${triggers.join(' · ')}` : '';

    const gustRow = `💨 ${range3(gustMin, gustMed, gustMax, ' km/h', km)}`;
    const precRow = `🌧 ${range3(precMin, precMed, precMax, ' mm', km1)}`;
    const windRow = `🌀 ${km(windMed)} km/h`;

    const dt = new Date(d.date + 'T12:00:00');
    const label = dt.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
    // Tiden (worldtides.info): Hoch/Niedrig-Zeiten des Tages, letzte Zeile
    const tideEvents = tideDaily[d.date] || [];
    const tideRow = tideEvents.length
      ? `<div class="w-row dim">🌊 ${tideEvents.map((e) =>
          `${e.type === 'Hoch' ? 'H' : 'N'} ${e.t}`).join(' · ')}</div>`
      : '';
    const kwhCls = d.kwh >= 4 ? 'good' : d.kwh >= 1.5 ? 'mid' : 'poor';
    return `<div class="fc-day w-day${warn ? ' warn' : ''}">
      <div class="fc-datel">${label}${d.date === today ? ' (heute)' : ''}</div>
      ${warn ? `<div class="w-warn">${warnText}</div>` : ''}
      <div class="fc-kwh ${kwhCls}">${d.kwh.toFixed(2)} kWh</div>
      <div class="w-row">${windRow}</div>
      <div class="w-row">${gustRow}</div>
      <div class="w-row">${precRow}</div>
      <div class="w-row">☀ ${d.sun_h == null ? '–' : d.sun_h + ' h'} · UV ${d.uv_max == null ? '–' : Math.round(d.uv_max)} · ☁ ${d.cloud ?? '–'} %</div>
      <div class="w-row">🌡 ${d.tmin ?? '–'}–${d.tmax ?? '–'} °C</div>
      <div class="w-row">👁 ${d.vis ?? '–'} km · 💧 ${d.rh ?? '–'} %</div>
      <div class="w-row dim">🌅 ${d.sunrise} – ${d.sunset}</div>
      ${tideRow}
      ${d.thunder_first ? `<div class="w-row warn2">⛈ Gewitter ab ca. ${d.thunder_first}</div>` : ''}
    </div>`;
  }).join('');
  $('wtiles').innerHTML = tiles;
}
async function load() {
  const status = $('status');
  try {
    status.textContent = 'lade…';
    const [w, alertsResp, tidesResp] = await Promise.all([
      fetchJSON('/weather'), fetchJSON('/alerts'), fetchJSON('/tides'),
    ]);
    $('w-headline').textContent =
      `Wetter – ${w.ort || ''} · 15 Tage Daten · Update ${new Date(w.fetched_at * 1000).toLocaleTimeString('de-DE')}`;
    renderAlerts(alertsResp);
    await update24(w);
    updateChart24(w);
    updateTiles(w, tidesResp);
    status.textContent = 'Daten OK';
    status.classList.remove('err');
  } catch (e) {
    status.textContent = 'FEHLER: ' + (e.message || e);
    status.classList.add('err');
  }
}

/* --- Offizielle Warnungen (MeteoAlarm/IPMA) --- */
function renderAlerts(resp) {
  const box = $('alerts-banner');
  const alerts = resp?.alerts || [];
  if (!alerts.length) { box.innerHTML = ''; return; }
  box.innerHTML = alerts.map((a) =>
    `<div class="alert-banner" style="background:${a.color};color:${a.text_color || '#fff'}">` +
    `<span class="alert-title">⚠ OFFIZIELLE WARNUNG (${a.level})</span>` +
    `<span>${a.event} · ${a.area}</span>` +
    `<span class="alert-time">${a.from} – ${a.to}</span>` +
    (a.text ? `<span class="alert-desc">${a.text}</span>` : '') +
    `</div>`
  ).join('');
}

load();
setInterval(load, 30 * 60000);
window.addEventListener('resize', () => {
  wetterPlot && wetterPlot.setSize({ width: $('wchart').clientWidth, height: 240 });
  load();
});
