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
  const sMid = Number(w.spread_mid || 15), sWarn = Number(w.spread_warn || 40);
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
  // Timing kommt von HARMONIE (hochauflösend) - B: "Pro Metrik das beste Modell"
  const harm = w.hourly.harm || null;
  const medianPrec = (i) => harm && harm.prec && harm.prec[i] != null
    ? Number(harm.prec[i]) : medianOf((m, j) => m.prec ? m.prec[j] : null, i, (j) => w.hourly.precip[j]);
  const medianWind = (i) => harm && harm.wind && harm.wind[i] != null
    ? Number(harm.wind[i]) : medianOf((m, j) => m.wind ? m.wind[j] : null, i, (j) => w.hourly.wind[j]);
  const medianGust = (i) => harm && harm.gust && harm.gust[i] != null
    ? Number(harm.gust[i]) : medianOf((m, j) => m.gust ? m.gust[j] : null, i, (j) => w.hourly.gusts[j]);
  const hours = [];
  for (let i = i0; i <= i1; i++) {
    // Konfidenz je Stunde über die 3 Modell-Werte
    const gv = pModels.map((m) => m.gust ? m.gust[i] : null).filter((v) => v != null).map(Number);
    const pv2 = pModels.map((m) => m.prec ? m.prec[i] : null).filter((v) => v != null).map(Number);
    const gMix = gv.length ? gv.reduce((a, b) => a + b, 0) / gv.length : null;
    const gMin = gv.length ? Math.min(...gv) : null;
    const gMax = gv.length ? Math.max(...gv) : null;
    const gPct = (gMix && gMax != null && gMin != null) ? (gMax - gMin) / gMix * 100 : 0;
    const gConf = gPct < sMid ? 'high' : (gPct < sWarn ? 'mid' : 'low');
    const wVal = harm && harm.wind && harm.wind[i] != null ? Number(harm.wind[i])
      : (w.hourly.wind[i] != null ? Number(w.hourly.wind[i]) : null);
    let gustTxt;
    if (gConf === 'low' && gMax != null) gustTxt = `unsicher: bis ${gMax.toFixed(0)}`;
    else if (gConf === 'mid' && gMax != null) gustTxt = `${gMin.toFixed(0)}–${gMax.toFixed(0)}`;
    else gustTxt = `${medianGust(i) == null ? '–' : Number(medianGust(i)).toFixed(0)}`;
    hours.push({
      t: times[i],
      label: new Date(times[i]).toLocaleDateString('de-DE', { weekday: 'short' }) + ' ' +
        new Date(times[i]).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
      day: new Date(times[i]).toLocaleDateString('de-DE', { weekday: 'short' }),
      temp: w.hourly.temp[i], wind: wVal, gust: medianGust(i),
      gustTxt, gConf,
      cloud: w.hourly.cloud[i], prec: medianPrec(i), precP: w.hourly.precip_prob[i],
      uv: w.hourly.uv[i], rh: w.hourly.rh[i], vis: w.hourly.vis_km[i],
      gMax, gMin, gConf,
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
    // Oranger Rahmen: MAX-Böen der Stunde über der Schwelle (pv.json warn_gust_hourly_kmh)
    const gustCls = (warnGustHourly > 0 && h.gMax != null && h.gMax >= warnGustHourly) ? ' gust-warn' : '';
    const gustDisp = (h.gConf === 'low' && h.gMax != null)
      ? `⚠ unsicher: bis ${h.gMax.toFixed(0)}`
      : (h.gConf === 'mid' && h.gMin != null)
        ? `${h.gMin.toFixed(0)}–${h.gMax.toFixed(0)}`
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

/* --- 7-Tage-Kacheln: nur heute + Zukunft, auf Breite verteilt --- */
function updateTiles(w) {
  const today = new Date().toISOString().slice(0, 10);
  const dirArrow = (deg) => {
    if (deg == null) return '';
    const dirs = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(deg / 45) % 8];
  };
  const days = w.daily.filter((d) => d.date >= today);
  const warnGust = Number(w.warn_gust || 60);
  const warnRain = Number(w.warn_rain_mm || 20);
  const sMid = Number(w.spread_mid || 15), sWarn = Number(w.spread_warn || 40);

  // Konfidenz-Logik: Spread = (max-min)/Mix in %
  //   low (>sWarn)  : "unsicher" -> Spanne + MAX-Wert fuer Warnungen
  //   mid           : Spanne anzeigen
  //   high (<sMid)  : Mix anzeigen
  const confOf = (min, max, mix) => {
    if (min == null || max == null || mix == null || mix <= 0) return { conf: null };
    const pct = (max - min) / mix * 100;
    return {
      conf: pct < sMid ? 'high' : (pct < sWarn ? 'mid' : 'low'),
      pct: Math.round(pct),
    };
  };
  const tiles = days.map((d) => {
    // A+B-Mix: Erwartung = Mittel der unabhängigen Quellen (HARMONIE + ECMWF);
    // Warnung: MAX-Wert >= Schwelle; bei Konfidenz 'low' als "unsicher" markiert
    const srcs = d.srcs || [];
    const harm = srcs.find((s) => s.name === 'harmonie') || null;
    const mixPrec = d.mix_prec != null ? Number(d.mix_prec)
      : (d.prec_median != null ? Number(d.prec_median) : (d.prec_mm != null ? Number(d.prec_mm) : null));
    const mixGust = d.mix_gust != null ? Number(d.mix_gust)
      : (d.gust_median != null ? Number(d.gust_median) : (d.gust != null ? Number(d.gust) : null));
    const harmGust = d.gust_harm != null ? Number(d.gust_harm)
      : (harm ? Number(harm.gust) : (d.gust != null ? Number(d.gust) : null));
    const harmWind = d.wind_harm != null ? Number(d.wind_harm)
      : (harm ? Number(harm.wind) : (d.wind != null ? Number(d.wind) : null));
    const cg = confOf(d.gust_min, d.gust_max, mixGust);
    const cp = confOf(d.prec_min, d.prec_max, mixPrec);

    // Warnung: MAX-Werte (Sicherheit zuerst)
    const gustWarnVal = d.gust_max != null ? Number(d.gust_max) : harmGust;
    const precWarnVal = d.prec_max != null ? Number(d.prec_max) : mixPrec;
    const triggers = [];
    if (gustWarnVal != null && gustWarnVal >= warnGust)
      triggers.push(`Böen bis ${gustWarnVal} km/h${cg.conf === 'low' ? ' (unsicher)' : ''}`);
    if (precWarnVal != null && precWarnVal >= warnRain)
      triggers.push(`Regen bis ${precWarnVal} mm${cp.conf === 'low' ? ' (unsicher)' : ''}`);
    const warn = triggers.length > 0;
    const warnText = warn ? `⚠ UNWETTER: ${triggers.join(' · ')}` : '';

    // Wind-/Regen-Zeile je Konfidenz
    let gustRow, precRow;
    if (cg.conf === 'low') {
      gustRow = `💨 unsicher: bis ${d.gust_max ?? harmGust ?? '–'} km/h`;
    } else if (cg.conf === 'mid') {
      gustRow = `💨 ${d.gust_min}–${d.gust_max} km/h`;
    } else {
      gustRow = `💨 ${harmWind ?? d.wind ?? '–'} / ${harmGust ?? d.gust ?? '–'} km/h (H)`;
    }
    if (cp.conf === 'low') {
      precRow = `🌧 unsicher: bis ${d.prec_max ?? '–'} mm`;
    } else if (cp.conf === 'mid') {
      precRow = `🌧 ${d.prec_min}–${d.prec_max} mm`;
    } else {
      precRow = `🌧 ${mixPrec == null ? '–' : mixPrec.toFixed(1)} mm / ${d.prec_prob ?? '–'} %`;
    }

    const dt = new Date(d.date + 'T12:00:00');
    const label = dt.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
    const kwhCls = d.kwh >= 4 ? 'good' : d.kwh >= 1.5 ? 'mid' : 'poor';
    const srcRow = srcs.length > 1
      ? srcs.map((s) => `${s.name === 'harmonie' ? 'H' : s.name === 'ecmwf' ? 'E' : s.name[0].toUpperCase()} ${s.gust}/${s.prec}`).join(' · ')
      : '';
    const confNote = (cg.conf === 'low' || cp.conf === 'low')
      ? `<div class="w-row warn2">↔ Modelle uneinig (Böen ±${cg.pct ?? '–'} %)</div>` : '';
    return `<div class="fc-day w-day${warn ? ' warn' : ''}">
      <div class="fc-datel">${label}${d.date === today ? ' (heute)' : ''}</div>
      ${warn ? `<div class="w-warn">${warnText}</div>` : ''}
      <div class="fc-kwh ${kwhCls}">${d.kwh.toFixed(2)} kWh</div>
      ${gustRow ? `<div class="w-row">${gustRow}</div>` : ''}
      <div class="w-row">☁ ${d.cloud ?? '–'} % · ${precRow}</div>
      <div class="w-row">☀ ${d.sun_h == null ? '–' : d.sun_h + ' h'} · UV ${d.uv_max == null ? '–' : Math.round(d.uv_max)}</div>
      <div class="w-row">🌡 ${d.tmin ?? '–'}–${d.tmax ?? '–'} °C</div>
      <div class="w-row">👁 ${d.vis ?? '–'} km · 💧 ${d.rh ?? '–'} %</div>
      <div class="w-row dim">🌅 ${d.sunrise} – ${d.sunset}</div>
      ${srcRow ? `<div class="w-row dim">${srcRow}</div>` : ''}
      ${confNote}
      ${d.thunder_first ? `<div class="w-row warn2">⛈ Gewitter ab ca. ${d.thunder_first}</div>` : ''}
    </div>`;
  }).join('');
  $('wtiles').innerHTML = tiles;
}
async function load() {
  const status = $('status');
  try {
    status.textContent = 'lade…';
    const [w, alertsResp] = await Promise.all([fetchJSON('/weather'), fetchJSON('/alerts')]);
    $('w-headline').textContent =
      `Wetter – ${w.ort || ''} · 15 Tage Daten · Update ${new Date(w.fetched_at * 1000).toLocaleTimeString('de-DE')}`;
    renderAlerts(alertsResp);
    await update24(w);
    updateTiles(w);
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
window.addEventListener('resize', () => load());
