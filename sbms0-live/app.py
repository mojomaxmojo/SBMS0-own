#!/usr/bin/env python3
"""
SBMS0 Live-Web (Phase 1)
========================
Leichte Web-App als Ersatz für das Grafana LIVE-Dashboard im Kiosk.

- Serviert die LIVE-Seite (Touchscreen-optimiert, dunkel)
- Proxy für InfluxDB-1.8-Queries (/query) – löst das CORS-Problem
  (Browser darf InfluxDB nicht direkt erreichen)

Aufruf:         python3 app.py [port]
Default-Port:   8090  (8088 ist von InfluxDB-RPC belegt!)
Abhängigkeiten: flask (pip3 install flask)
"""

import os
import sys

import requests
from flask import Flask, jsonify, request, send_from_directory

INFLUX_URL = os.environ.get('SBMS_INFLUX_URL', 'http://localhost:8086/query')
INFLUX_DB = os.environ.get('SBMS_INFLUX_DB', 'SBMS')

# alarm.json liegt im Repo-Ordner (eine Ebene ueber sbms0-live/) und kann
# manuell editiert werden -> /alarm liefert sie an die Web-App aus.
ALARM_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'alarm.json')

# pv.json dito: PV-Prognose-Konfiguration (Position, kWp, Neigung ...)
PV_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'pv.json')

_PV_FALLBACK = {
    'ort': 'Manta Rota, Portugal', 'latitude': 37.16381661361134, 'longitude': -7.522141757857421,
    'kwp': 2.25, 'cells_area': 9.64, 'cells_efficiency': 22,
    'temp_coeff': -0.4, 'diffuse_efficiency': 100, 'albedo': 0.2,
    'tilt': 0, 'azimuth': 180,
    'inverter_power': 3500, 'inverter_efficiency': 90,
    'shade_from': '', 'shade_percent': 100,
    'performance_ratio': 1.0,
    'timezone': 'Europe/Lisbon', 'forecast_days': 7, 'service': 'open-meteo',
}


def load_json_cfg(path, fallback):
    try:
        import json
        with open(path, 'r', encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return fallback

# Einfacher Prozess-Cache fuer die Open-Meteo-Prognose (30 min)
_FC_CACHE = {'ts': 0, 'data': None}
FC_TTL = 30 * 60
# Cache fuer den Reinigungs-Hinweis (6 h - Regenbericht aendert sich langsam)
_RAIN_CACHE = {'ts': 0, 'data': None}

# Cache fuer offizielle Wetterwarnungen (MeteoAlarm/IPMA), 30 min
_ALERTS_CACHE = {'ts': 0, 'data': None}
ALERTS_TTL = 30 * 60

_LEVEL_MAP = {'minor': ('Gelb', '#f2cc0c', '#333333'),
              'moderate': ('Gelb', '#f2cc0c', '#333333'),
              'severe': ('Orange', '#ff9830', '#ffffff'),
              'extreme': ('Rot', '#f2495c', '#ffffff')}

# Ereignis-Typen (IPMA/MeteoAlarm) -> Deutsch. Der Feed liefert nur PT/EN,
# daher uebersetzen wir die ART selbst; Beschreibungstext bleibt Englisch
# (Deutsch wird vom IPMA/MeteoAlarm-Feed nicht bereitgestellt).
_EVENT_DE = [
    ('precipitação', 'rain', 'Regen'),
    ('trovoada', 'thunderstorm', 'Gewitter'),
    ('vento', 'wind', 'Wind'),
    ('agitação marítima', 'coastal event', 'Seegang'),
    ('neve', 'snow', 'Schnee'),
    ('nevoeiro', 'fog', 'Nebel'),
    ('temperaturas', 'temperature', 'Temperatur'),
    ('ciclone', 'cyclone', 'Zyklon'),
]


def _event_de(event, headline):
    blob = f'{event} {headline}'.lower()
    for pt, en, de in _EVENT_DE:
        if pt in blob or en in blob:
            return de
    return event


def _alerts_dataset():
    """Offizielle Wetterwarnungen (MeteoAlarm, gespeist von IPMA) für
    Faro/Algarve. Feed: feeds.meteoalarm.org/api/v1/warnings/feeds-portugal
    (CAP-Struktur: warnings[].alert.info[]). Nur AKTUELLE Warnungen
    (expires >= jetzt). 30-min-Cache; Feed-Fehler -> leer."""
    import time as _time
    import datetime as _dt
    cfg = dict(_PV_FALLBACK)
    cfg.update(load_json_cfg(PV_PATH, {}))   # alert_areas aus pv.json
    now = _time.time()
    if _ALERTS_CACHE['data'] is not None and now - _ALERTS_CACHE['ts'] < ALERTS_TTL:
        return _ALERTS_CACHE['data'], None
    try:
        r = requests.get(
            'https://feeds.meteoalarm.org/api/v1/warnings/feeds-portugal',
            timeout=20,
        )
        r.raise_for_status()
        raw = r.json()
    except (requests.RequestException, ValueError):
        return [], None   # Feed nicht erreichbar -> keine Warnungen, kein Fehler

    alerts = []
    try:
        now_dt = _dt.datetime.now(_dt.timezone.utc)
        for entry in raw.get('warnings', []):
            alert = entry.get('alert') or {}
            # Der Feed liefert pro Warnung zwei info-Eintraege (pt-PT, en-GB)
            # -> wir nutzen die ENGLISCHE (lesbarer als PT) und uebersetzen
            # Ereignis-Typ + Stufe selbst auf Deutsch.
            infos = alert.get('info', []) or []
            info = next((i for i in infos
                         if str(i.get('language', '')).startswith('en')), None)
            if info is None and infos:
                info = infos[0]
            if info is None:
                continue
            areas = [a.get('areaDesc', '') for a in (info.get('area') or [])]
            # Gebietsfilter aus pv.json (alert_areas, kommasepariert)
            want = [x.strip().lower() for x in str(cfg.get('alert_areas', 'Faro') or 'Faro').split(',') if x.strip()]
            if want and not any(any(w in a.lower() for w in want) for a in areas):
                continue
            expires = info.get('expires', '')
            try:
                exp = _dt.datetime.fromisoformat(expires)
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=_dt.timezone.utc)
                if exp < now_dt:
                    continue   # abgelaufen
            except ValueError:
                pass
            sev = str(info.get('severity') or '').lower()
            level, color, txtcol = _LEVEL_MAP.get(sev, (sev.capitalize() or '?', '#f2cc0c', '#ffffff'))
            alerts.append({
                'event': _event_de(info.get('event') or '', info.get('headline') or ''),
                'level': level,
                'color': color,
                'text_color': txtcol,
                'from': (info.get('onset') or '')[:16].replace('T', ' '),
                'to': expires[:16].replace('T', ' '),
                'area': ' / '.join(a for a in areas if a),
                'text': (info.get('description') or '')[:300],
            })
    except (TypeError, KeyError, ValueError):
        pass
    # Sortierung: aktuell AKTIVE zuerst (jetzt im Zeitfenster), danach
    # zukünftige chronologisch nach Beginn.
    def _sort_key(a):
        try:
            onset = _dt.datetime.fromisoformat(a['from'].replace(' ', 'T'))
            if onset.tzinfo is None:
                onset = onset.replace(tzinfo=_dt.timezone.utc)
        except ValueError:
            onset = _dt.datetime.max.replace(tzinfo=_dt.timezone.utc)
        active = onset <= now_dt
        return (0 if active else 1, onset)
    alerts.sort(key=_sort_key)
    _ALERTS_CACHE['ts'] = now
    _ALERTS_CACHE['data'] = alerts
    return alerts, None


# Median-Helfer (Modul-Ebene, auch für stündliche Median-Felder)
def _med(vals):
    s = sorted(v for v in vals if v is not None)
    if not s:
        return None
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


# EIN Open-Meteo-Call fuer ALLES: 7 Tage zurueck + 7 Tage vor (15 Tage stündlich)
_WEATHER_CACHE = {'ts': 0, 'data': None}
WEATHER_TTL = 30 * 60


def _weather_dataset():
    """Ein Open-Meteo-Abruf (past_days=7, forecast_days=7) mit allen Feldern;
    solXcept-Watt werden EINMAL stündlich berechnet. 30-min-Cache."""
    import time as _time
    now = _time.time()
    if _WEATHER_CACHE['data'] is not None and now - _WEATHER_CACHE['ts'] < WEATHER_TTL:
        return _WEATHER_CACHE['data'], None

    cfg = dict(_PV_FALLBACK)
    cfg.update(load_json_cfg(PV_PATH, {}))
    try:
        r = requests.get(
            'https://api.open-meteo.com/v1/forecast',
            params={
                'latitude': cfg.get('latitude'),
                'longitude': cfg.get('longitude'),
                'hourly': 'direct_normal_irradiance,diffuse_radiation,'
                          'shortwave_radiation,temperature_2m,relative_humidity_2m,'
                          'visibility,cloud_cover,precipitation,'
                          'precipitation_probability,uv_index,wind_speed_10m,'
                          'wind_gusts_10m,wind_direction_10m,weathercode',
                'daily': 'sunrise,sunset,sunshine_duration,wind_direction_10m_dominant',
                'past_days': 7, 'forecast_days': 7,
                'timezone': 'UTC', 'models': 'best_match',
            },
            timeout=25,
        )
        r.raise_for_status()
        raw = r.json()
    except (requests.RequestException, ValueError) as e:
        return None, 'Open-Meteo nicht erreichbar: ' + str(e)[:150]

    try:
        hourly = raw['hourly']
        import solar as _solar
        plant = _solar.Plant(cfg)
        hours = _solar.hourly_watts(
            plant, hourly['time'],
            hourly['direct_normal_irradiance'], hourly['diffuse_radiation'],
            hourly['shortwave_radiation'], hourly['temperature_2m'],
            cfg.get('timezone', 'Europe/Lisbon'))
        if not hours:
            return None, 'Keine Stunden-Daten'
        times = [t for t, _ in hours]
        watts = [w for _, w in hours]

        def h_field(name):
            return hourly.get(name, [None] * len(times))

        # --- Multi-Modell-Regenvergleich (Schwellwerte/Median, pv.json: rain_models) ---
        import datetime as _dt
        models_list = [m.strip() for m in str(cfg.get('rain_models', '') or '').split(',') if m.strip()]
        models_precip = []     # [{'model': name, 'prec': [mm je Stunde, an times ausgerichtet]}]
        models_daily = {}      # {model: {tag: mm}}
        if models_list:
            try:
                try:
                    from zoneinfo import ZoneInfo
                    ltz_mm = ZoneInfo(cfg.get('timezone', 'Europe/Lisbon'))
                except Exception:
                    ltz_mm = _dt.timezone.utc
                r2 = requests.get(
                    'https://api.open-meteo.com/v1/forecast',
                    params={
                        'latitude': cfg.get('latitude'),
                        'longitude': cfg.get('longitude'),
                        'hourly': 'precipitation,wind_speed_10m,wind_gusts_10m',
                        'past_days': 7, 'forecast_days': 7,
                        'timezone': 'UTC', 'models': ','.join(models_list),
                    },
                    timeout=25,
                )
                r2.raise_for_status()
                j2 = r2.json()
                # API-Antwort bei Multi-Modell: EIN dict mit Schlüsseln
                # "precipitation_<model>" (nicht einzelne Blöcke!)
                h2 = j2.get('hourly') or {}
                for mname in models_list:
                    vals2 = h2.get('precipitation_' + mname)
                    wvals = h2.get('wind_speed_10m_' + mname)
                    gvals = h2.get('wind_gusts_10m_' + mname)
                    if vals2 is None:
                        continue   # Modell von der API nicht geliefert
                    lmap = {}
                    wmap = {}
                    gmap = {}
                    mdays = {}
                    mdays_w = {}
                    mdays_g = {}
                    for j3, t2 in enumerate(h2.get('time', [])):
                        dt2 = _dt.datetime.strptime(t2, '%Y-%m-%dT%H:%M').replace(tzinfo=_dt.timezone.utc)
                        loc = dt2.astimezone(ltz_mm)
                        liso = loc.strftime('%Y-%m-%dT%H:%M')
                        day = loc.strftime('%Y-%m-%d')
                        lmap[liso] = vals2[j3] if j3 < len(vals2) else None
                        if wvals is not None and j3 < len(wvals) and wvals[j3] is not None:
                            wmap[liso] = float(wvals[j3])
                            mdays_w[day] = max(mdays_w.get(day, 0.0), float(wvals[j3]))
                        if gvals is not None and j3 < len(gvals) and gvals[j3] is not None:
                            gmap[liso] = float(gvals[j3])
                            mdays_g[day] = max(mdays_g.get(day, 0.0), float(gvals[j3]))
                        v2 = vals2[j3] if j3 < len(vals2) else None
                        mdays[day] = mdays.get(day, 0.0) + float(v2 or 0)
                    models_precip.append({
                        'model': mname,
                        'prec': [lmap.get(t) for t in times],
                        'wind': [wmap.get(t) for t in times],
                        'gust': [gmap.get(t) for t in times],
                        'mdays': mdays, 'mdays_w': mdays_w, 'mdays_g': mdays_g,
                    })
                    models_daily[mname] = mdays
            except (requests.RequestException, ValueError):
                pass   # Modell-Call fehlgeschlagen -> Kacheln zeigen best_match weiter

        # WMO-Wettercodes (Gewitter = 95/96/99) je Stunde + Tagesinfo
        # (VOR der Tages-Auswertung - daily braucht thunder_by_day!)
        wmo = h_field('weathercode')
        thunder_by_day = {}   # day -> erster Gewitter-Stunden-Label
        for i, t in enumerate(times):
            c = wmo[i]
            if c is not None and int(c) >= 95:
                thunder_by_day.setdefault(t[:10], t[11:16])

        # Quellen-Gruppierung: identische Datensätze deduplizieren.
        # metno_seamless und dmi_seamless liefern bei dieser Koordinate
        # IDENTISCHE Werte (beide HARMONIE-AROME-Familie) -> eine Quelle
        # "harmonie"; ECMWF ist die zweite unabhängige Quelle.
        def _sig(m_p, m_g):
            days = sorted(set(list(m_p) + list(m_g)))
            return tuple((round(m_p.get(d, 0.0), 1), round(m_g.get(d, 0.0), 0)) for d in days)

        groups = []
        for mp in models_precip:
            s = _sig(mp['mdays'], mp.get('mdays_g') or {})
            for g in groups:
                if g['sig'] == s:
                    g['members'].append(mp)
                    break
            else:
                groups.append({'sig': s, 'members': [mp]})

        def _gname(members):
            names = [m['model'] for m in members]
            if any(('metno' in n or 'dmi' in n) for n in names):
                return 'harmonie'
            if any('ecmwf' in n for n in names):
                return 'ecmwf'
            return names[0]

        for g in groups:
            g['name'] = _gname(g['members'])

        # Tages-Zusammenfassung aus den lokalen Stunden (Tagesgrenzen lokal!)
        daily_map = {}
        for i, t in enumerate(times):
            day = t[:10]
            d = daily_map.setdefault(day, {
                'kwh': 0.0, 'uv': None, 'cloud': [], 'prec_mm': 0.0,
                'prec_prob': None, 'wind': None, 'gust': None,
                'tmax': None, 'tmin': None, 'vis': [], 'rh': [],
            })
            d['kwh'] += watts[i] / 1000.0
            for mp in models_precip:
                v = mp['prec'][i]
                key = f"mm_{mp['model']}"
                d[key] = d.get(key, 0.0) + float(v or 0)
            uv, cl = h_field('uv_index')[i], h_field('cloud_cover')[i]
            pr_mm, pr_p = h_field('precipitation')[i], h_field('precipitation_probability')[i]
            wd, wg = h_field('wind_speed_10m')[i], h_field('wind_gusts_10m')[i]
            te, vis, rh = h_field('temperature_2m')[i], h_field('visibility')[i], h_field('relative_humidity_2m')[i]
            if uv is not None:
                d['uv'] = max(d['uv'] or 0, float(uv))
            if cl is not None:
                d['cloud'].append(float(cl))
            if pr_mm is not None:
                d['prec_mm'] += float(pr_mm)
            if pr_p is not None:
                p = float(pr_p)
                d['prec_prob'] = p if d['prec_prob'] is None else max(d['prec_prob'], p)
            if wd is not None:
                d['wind'] = float(wd) if d['wind'] is None else max(d['wind'], float(wd))
            if wg is not None:
                d['gust'] = float(wg) if d['gust'] is None else max(d['gust'], float(wg))
            if te is not None:
                te = float(te)
                d['tmax'] = te if d['tmax'] is None else max(d['tmax'], te)
                d['tmin'] = te if d['tmin'] is None else min(d['tmin'], te)
            if vis is not None:
                d['vis'].append(float(vis) / 1000.0)
            if rh is not None:
                d['rh'].append(float(rh))

        # Sonnenauf/-untergang + Sonnenscheindauer aus daily (UTC -> lokal)
        import datetime as _dt
        try:
            from zoneinfo import ZoneInfo
            ltz = ZoneInfo(cfg.get('timezone', 'Europe/Lisbon'))
        except Exception:
            ltz = _dt.timezone.utc
        daily_raw = raw.get('daily', {})
        sun_map = {}
        for i, dd in enumerate(daily_raw.get('time', [])):
            day_key = dd  # UTC-Datum == lokales Datum (UTC+0); Sommer: ±1 h tolerated
            sun_map[day_key] = {
                'sunrise': daily_raw.get('sunrise', [''])[i],
                'sunset': daily_raw.get('sunset', [''])[i],
                'sun_h': round((daily_raw.get('sunshine_duration', [0])[i] or 0) / 3600.0, 1),
                'dir': daily_raw.get('wind_direction_10m_dominant', [None])[i],
            }

        daily = []
        for day, d in sorted(daily_map.items()):
            s = sun_map.get(day, {})

            # Quellen-Werte (dedupliziert, je Modell-Gruppe).
            srcs = []
            for g in groups:
                precs = [float(m['mdays'].get(day) or 0) for m in g['members']]
                gusts_ = [float(m['mdays_g'].get(day) or 0) for m in g['members']]
                winds_ = [float(m['mdays_w'].get(day) or 0) for m in g['members']]
                if not srcs or True:
                    srcs.append({
                        'name': g['name'],
                        'prec': round(sum(precs) / len(precs), 1) if precs else 0.0,
                        'gust': round(max(gusts_), 0) if gusts_ else 0.0,
                        'wind': round(max(winds_), 0) if winds_ else 0.0,
                    })
            d['srcs'] = srcs
            if srcs:
                # Min / Median / Max je Metrik über alle Modell-Quellen.
                # Median wird FETT hervorgehoben (weather.js) und ist die
                # EINZIGE Grundlage für Unwetter-Warnungen (⚠ nur Median).
                def _md3(vals):
                    srt = sorted(vals)
                    m = len(srt) // 2
                    med = srt[m] if len(srt) % 2 else (srt[m - 1] + srt[m]) / 2
                    return round(min(srt), 1), round(med, 1), round(max(srt), 1)

                d['prec_min'], d['prec_med'], d['prec_max'] = _md3(
                    [x['prec'] for x in srcs])
                d['gust_min'], d['gust_med'], d['gust_max'] = _md3(
                    [x['gust'] for x in srcs])
                d['wind_min'], d['wind_med'], d['wind_max'] = _md3(
                    [x['wind'] for x in srcs])

            harm = next((x for x in srcs if x['name'] == 'harmonie'), None)
            if harm:
                d['prec_harm'] = harm['prec']
                d['gust_harm'] = harm['gust']
                d['wind_harm'] = harm['wind']

            d['prec_models'] = {mp['model']: {
                'prec': round(mp['mdays'].get(day, 0.0), 1),
                'gust': round(mp['mdays_g'].get(day, 0.0), 0),
                'wind': round(mp['mdays_w'].get(day, 0.0), 0),
            } for mp in models_precip if mp['mdays']}

            daily.append({
                'date': day,
                'kwh': round(d['kwh'], 2),
                'sun_h': s.get('sun_h'),
                'uv_max': None if d['uv'] is None else round(d['uv'], 1),
                'cloud': None if not d['cloud'] else round(sum(d['cloud']) / len(d['cloud']), 0),
                'prec_mm': round(d['prec_mm'], 1),
                'prec_prob': d['prec_prob'],
                'wind': None if d['wind'] is None else round(d['wind'], 0),
                'gust': None if d['gust'] is None else round(d['gust'], 0),
                'tmax': None if d['tmax'] is None else round(d['tmax'], 0),
                'tmin': None if d['tmin'] is None else round(d['tmin'], 0),
                'vis': None if not d['vis'] else round(sum(d['vis']) / len(d['vis']), 1),
                'rh': None if not d['rh'] else round(sum(d['rh']) / len(d['rh']), 0),
                'sunrise': (s.get('sunrise') or '')[11:16],
                'sunset': (s.get('sunset') or '')[11:16],
                'dir': s.get('dir'),
                'thunder_first': thunder_by_day.get(day),
                'prec_models': d.get('prec_models'),
                'wind_models': d.get('wind_models'),
                'srcs': d.get('srcs'),
                'prec_min': d.get('prec_min'), 'prec_med': d.get('prec_med'),
                'prec_max': d.get('prec_max'),
                'gust_min': d.get('gust_min'), 'gust_med': d.get('gust_med'),
                'gust_max': d.get('gust_max'),
                'wind_min': d.get('wind_min'), 'wind_med': d.get('wind_med'),
                'wind_max': d.get('wind_max'),
            })

        # Stündliche Median-Werte über die Modelle (für den 24-h-Chart) -
        # konsistent mit den Tages-Kacheln (gleiche Modell-Familie)
        n_hours = len(times)
        med = {'precip': [], 'wind': [], 'gusts': []}
        for i in range(n_hours):
            med['precip'].append(round(_med([mp['prec'][i] for mp in models_precip]) or 0, 2))
            med['wind'].append(round(_med([mp['wind'][i] for mp in models_precip]) or 0, 1))
            med['gusts'].append(round(_med([mp['gust'][i] for mp in models_precip]) or 0, 1))

        # HARMONIE-Stundenwerte (Timing für die 24-h-Kacheln)
        harm_mp = next((mp for mp in models_precip
                        if 'metno' in mp['model'] or 'dmi' in mp['model']), None)
        harm_hourly = ({'prec': harm_mp['prec'], 'wind': harm_mp['wind'], 'gust': harm_mp['gust']}
                       if harm_mp else None)

        # MET Norway (api.met.no) als VERGLEICHsquelle nur für WETTER:
        # vorgeglättetes Fusionsprodukt (HARMONIE+ECMWF) — keine PV-Daten!
        # api.met.no verlangt einen User-Agent und max 4 Dezimalstellen.
        met_arrs = None
        try:
            import datetime as _dt3
            try:
                from zoneinfo import ZoneInfo as _ZI
                ltz = _ZI(cfg.get('timezone', 'Europe/Lisbon'))
            except Exception:
                ltz = _dt3.timezone.utc
            r3 = requests.get(
                'https://api.met.no/weatherapi/locationforecast/2.0/compact',
                params={'lat': round(float(cfg.get('latitude', 0)), 4),
                        'lon': round(float(cfg.get('longitude', 0)), 4)},
                headers={'User-Agent': 'SBMS0-LiveWeb/1.0 (mojomaxmojo/SBMS0-own)',
                         'Accept': 'application/json'},
                timeout=15,
            )
            r3.raise_for_status()
            j3 = r3.json()
            mmap = {}
            for e3 in j3.get('properties', {}).get('timeseries', []):
                t3 = e3.get('time', '')           # "2026-11-08T18:00:00Z"
                if len(t3) < 16:
                    continue
                dt3 = _dt3.datetime.strptime(t3[:16], '%Y-%m-%dT%H:%M').replace(
                    tzinfo=_dt3.timezone.utc).astimezone(ltz)
                key3 = dt3.strftime('%Y-%m-%dT%H:%M')
                d3 = e3.get('data') or {}
                inst = (d3.get('instant') or {}).get('details') or {}
                n1 = d3.get('next_1_hours') or {}
                det = n1.get('details') or {}
                ws = inst.get('wind_speed')       # m/s -> km/h
                mmap[key3] = {
                    'temp': inst.get('air_temperature'),
                    'wind': round(ws * 3.6, 1) if ws is not None else None,
                    'prec': det.get('precipitation_amount'),
                    'sym': (n1.get('summary') or {}).get('symbol_code'),
                }
            met_arrs = {
                'temp': [ (mmap.get(t) or {}).get('temp') for t in times ],
                'wind': [ (mmap.get(t) or {}).get('wind') for t in times ],
                'prec': [ (mmap.get(t) or {}).get('prec') for t in times ],
                'sym':  [ (mmap.get(t) or {}).get('sym') for t in times ],
            }
        except (requests.RequestException, ValueError, KeyError) as e:
            print(f'[WETTER] MET Norway nicht erreichbar: {str(e)[:120]}', flush=True)

        data = {
            'times': times, 'watts': watts,
            'hourly': {
                'temp': h_field('temperature_2m'),
                'wmo': wmo,
                'rh': h_field('relative_humidity_2m'),
                'vis_km': [None if v is None else round(v / 1000.0, 1) for v in h_field('visibility')],
                'cloud': h_field('cloud_cover'),
                'precip': h_field('precipitation'),
                'precip_prob': h_field('precipitation_probability'),
                'uv': h_field('uv_index'),
                'wind': h_field('wind_speed_10m'),
                'gusts': h_field('wind_gusts_10m'),
                'wdir': h_field('wind_direction_10m'),
                'precip_models': models_precip,
                'med': med,
                'harm': harm_hourly,
                'met': met_arrs,
            },
            'daily': daily,
            'ort': cfg.get('ort'), 'kwp': float(cfg.get('kwp', 0) or 0),
            'warn_gust': float(cfg.get('warn_gust_kmh', 60) or 60),
            'warn_rain_mm': float(cfg.get('warn_rain_mm', 20) or 20),
            'warn_gust_hourly': float(cfg.get('warn_gust_hourly_kmh', 60) or 60),
            'fetched_at': int(now),
        }
    except (KeyError, TypeError, ValueError) as e:
        return None, 'Unerwartetes Open-Meteo-Format: ' + str(e)[:150]

    _WEATHER_CACHE['ts'] = now
    _WEATHER_CACHE['data'] = data
    return data, None

_ALARM_FALLBACK = {
    'banner_titel': 'BATTERIE-FEHLER',
    'error_flags': ['UVLK', 'OVLK', 'COC', 'DOC', 'DSC', 'OPEN', 'CELF', 'LVC'],
    'flags': {
        'DFET': 'DFET (Entladen EIN)', 'EOC': 'EOC (Ladeende)',
        'CFET': 'CFET (Laden EIN)', 'ECCF': 'ECCF (Zellen-Balance)',
        'LVC': 'FEHLER: Zelle zu tief', 'OPEN': 'FEHLER: Zellkabel',
        'CELF': 'FEHLER: Zellfehler', 'DSC': 'FEHLER: Kurzschluss',
        'DOC': 'FEHLER: Ueberstrom Entladen', 'COC': 'FEHLER: Ueberstrom Laden',
        'IOT': 'IOT (Temperatur)', 'UVLK': 'FEHLER: FET-Kurzschluss',
        'UV': 'UV (Unterspannung)', 'OVLK': 'FEHLER: FET-Kurzschluss',
        'OV': 'OV (Ueberspannung)',
    },
}


def load_alarm_config():
    try:
        import json
        with open(ALARM_PATH, 'r', encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return _ALARM_FALLBACK

app = Flask(__name__, static_folder='static', static_url_path='/static')


@app.route('/')
def index():
    return send_from_directory('templates', 'start.html')


@app.route('/live')
def live():
    return send_from_directory('templates', 'live.html')


@app.route('/calc')
def calc():
    return send_from_directory('templates', 'calc.html')


@app.route('/hist')
def hist():
    return send_from_directory('templates', 'hist.html')


@app.route('/prognose')
def prognose():
    return send_from_directory('templates', 'prognose.html')


@app.route('/pvcompare')
def pvcompare():
    """Ist-vs-Prognose: taeglicher REAL-Ertrag (InfluxDB, raw_1s) vs.
    solXcept-Modell-Rueckrechnung (Open-Meteo, past_days=7) fuer die
    letzten 7 Tage (+ heute)."""
    import json as _json
    from datetime import datetime, timedelta, timezone

    cfg = dict(_PV_FALLBACK)
    cfg.update(load_json_cfg(PV_PATH, {}))
    kwp = float(cfg.get('kwp', 0) or 0)
    pr = float(cfg.get('performance_ratio', 1.0) or 1.0)   # Feintune-Faktor
    tzname = cfg.get('timezone', 'Europe/Lisbon')

    # --- Open-Meteo: gemeinsamer 15-Tage-Datensatz (Cache) ---
    data, err = _weather_dataset()
    if err:
        return jsonify({'error': err}), 502

    fc_by_day = {}
    for t_iso, w in zip(data['times'], data['watts']):
        day = t_iso[:10]
        fc_by_day[day] = fc_by_day.get(day, 0.0) + w / 1000.0

    # --- REAL-Ertrag aus InfluxDB: stündliche kWh (raw_1s) ---
    try:
        from zoneinfo import ZoneInfo
        LOCAL_TZ = ZoneInfo(tzname)
    except Exception:
        LOCAL_TZ = timezone.utc

    real_by_day = {}
    try:
        # EINHEITLICHE lueckenfeste Methode (wie BERECHNUNGEN/HISTORIE):
        # je Stunde mean + count aus downsampled_1m; Energie je Stunde =
        # mean W × (count = Minuten mit Daten) / 60. Teilstunden (Wyse-Boot
        # mitten in der Stunde) zaehlen anteilig, keine vollen Stunden.
        r2 = requests.get(
            INFLUX_URL,
            params={'db': INFLUX_DB, 'epoch': 'ms', 'throttle': '0',
                    'q': 'SELECT mean("PV Power W") AS m, count("PV Power W") AS c '
                         'FROM "downsampled_1m"."SBMS_Metrics" '
                         "WHERE \"Name\" = 'SBMS0a' AND time > now() - 8d "
                         'GROUP BY time(1h) fill(null)'},
            timeout=30,
        )
        r2.raise_for_status()
        s = r2.json()['results'][0]['series'][0]
        for ts, m, c in s['values']:
            if m is None or not c:
                continue
            day = datetime.fromtimestamp(ts / 1000, tz=LOCAL_TZ).strftime('%Y-%m-%d')
            real_by_day[day] = round(
                real_by_day.get(day, 0.0) + float(m) * float(c) / 60 / 1000, 3)
    except (requests.RequestException, ValueError, KeyError, IndexError):
        pass  # Influx-Fehler: real bleibt leer, Seite zeigt nur Prognose

    # --- Zusammenführen: letzte 7 lokale Tage + heute ---
    today_local = datetime.now(LOCAL_TZ).strftime('%Y-%m-%d')
    days = sorted(set(list(fc_by_day.keys()) + list(real_by_day.keys())))
    out = []
    for day in days:
        if day > today_local:
            continue
        fc_kwh = round(fc_by_day.get(day, 0.0), 2)
        re_kwh = real_by_day.get(day)
        diff = None
        if re_kwh is not None and fc_kwh > 0:
            diff = round((re_kwh - fc_kwh) / fc_kwh * 100, 0)
        out.append({'date': day, 'forecast': fc_kwh, 'real': re_kwh, 'diff_pct': diff})

    return jsonify({'pr': pr, 'kwp': kwp, 'timezone': tzname, 'model': 'solXpect',
                    'days': out[-8:]})
@app.route('/pvhourly')
def pvhourly():
    """Tagesgang-Vergleich für einen vergangenen Tag (innerhalb der letzten
    7 Tage): stündlich Prognose (solXcept-Modell) vs. Real (Influx-Mittel)
    vs. SOC."""
    from datetime import datetime, timedelta, timezone as _tz

    cfg = dict(_PV_FALLBACK)
    cfg.update(load_json_cfg(PV_PATH, {}))
    tzname = cfg.get('timezone', 'Europe/Lisbon')
    day = request.args.get('date', '')
    try:
        day_dt = datetime.strptime(day, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({'error': 'date Parameter fehlt/format falsch (JJJJ-MM-TT)'}), 400

    try:
        from zoneinfo import ZoneInfo
        LOCAL_TZ = ZoneInfo(tzname)
    except Exception:
        LOCAL_TZ = _tz.utc
    today = datetime.now(LOCAL_TZ).date()
    if day_dt > today or day_dt < today - timedelta(days=7):
        return jsonify({'error': 'Datum muss innerhalb der letzten 7 Tage liegen'}), 400

    # --- Open-Meteo: gemeinsamer 15-Tage-Datensatz (Cache) ---
    data, err = _weather_dataset()
    if err:
        return jsonify({'error': err}), 502

    fc_by_hour = {}
    for t_iso, w in zip(data['times'], data['watts']):
        if t_iso[:10] == day:
            fc_by_hour[t_iso[11:16]] = w

    # --- Real + SOC aus InfluxDB (Stundenmittel des gewählten Tages) ---
    d_start = int(datetime(day_dt.year, day_dt.month, day_dt.day,
                           tzinfo=LOCAL_TZ).timestamp() * 1000)
    d_end = d_start + 86400 * 1000
    real_by_hour, soc_by_hour = {}, {}
    try:
        r2 = requests.get(
            INFLUX_URL,
            params={'db': INFLUX_DB, 'epoch': 'ms', 'throttle': '0',
                    'q': 'SELECT mean("PV Power W") AS p, mean("State of Charge") AS soc '
                         'FROM "raw_1s"."SBMS_Metrics" '
                         "WHERE \"Name\" = 'SBMS0a' AND time >= %dms AND time < %dms "
                         'GROUP BY time(1h) fill(null)' % (d_start, d_end)},
            timeout=30,
        )
        r2.raise_for_status()
        s = r2.json()['results'][0]['series'][0]
        for ts, p, soc in s['values']:
            hh = datetime.fromtimestamp(ts / 1000, tz=LOCAL_TZ).strftime('%H:00')
            if p is not None:
                real_by_hour[hh] = round(float(p), 1)
            if soc is not None:
                soc_by_hour[hh] = round(float(soc), 1)
    except (requests.RequestException, ValueError, KeyError, IndexError):
        pass

    hours_out = []
    for hh in sorted(set(list(fc_by_hour.keys()) + list(real_by_hour.keys()))):
        hours_out.append({
            'h': hh,
            'fc': fc_by_hour.get(hh),
            'real': real_by_hour.get(hh),
            'soc': soc_by_hour.get(hh),
        })
    return jsonify({'date': day, 'timezone': tzname, 'hours': hours_out})


@app.route('/alerts')
def alerts():
    """Offizielle Wetterwarnungen (MeteoAlarm/IPMA, Algarve), 30-min-Cache."""
    alerts, err = _alerts_dataset()
    return jsonify({'alerts': alerts, 'error': err})


@app.route('/rain')
def rain():
    """Reinigungs-Hinweis: Tage seit letztem Waschregen (Open-Meteo,
    30 Rueck-Tage) vs. Tage seit letzter manueller Reinigung (pv.json)."""
    import time as _time
    from datetime import datetime, timedelta

    now = _time.time()
    if _RAIN_CACHE['data'] is not None and now - _RAIN_CACHE['ts'] < 6 * 3600:
        return jsonify(_RAIN_CACHE['data'])

    cfg = dict(_PV_FALLBACK)
    cfg.update(load_json_cfg(PV_PATH, {}))
    try:
        tzname = cfg.get('timezone', 'Europe/Lisbon')
        from zoneinfo import ZoneInfo
        LOCAL_TZ = ZoneInfo(tzname)
    except Exception:
        from datetime import timezone as _tz
        LOCAL_TZ = _tz.utc
    today = datetime.now(LOCAL_TZ).date()

    last_rain = None
    rain_mm_7d = 0.0
    try:
        r = requests.get(
            'https://api.open-meteo.com/v1/forecast',
            params={
                'latitude': cfg.get('latitude'),
                'longitude': cfg.get('longitude'),
                'daily': 'precipitation_sum',
                'past_days': 30, 'forecast_days': 1,
                'timezone': 'Europe/Berlin',
            },
            timeout=15,
        )
        r.raise_for_status()
        daily = r.json()['daily']
        dates = daily['time']
        mm = daily['precipitation_sum']
        for d, v in zip(dates, mm):
            if v is not None and float(v) >= 5.0:      # >= 5 mm = "Waschregen"
                last_rain = d
            if d >= (today - timedelta(days=7)).isoformat() and v is not None:
                rain_mm_7d += float(v)
    except (requests.RequestException, ValueError, KeyError):
        pass  # offline -> nur last_cleaned bewerten

    days_rain = (today - datetime.strptime(last_rain, '%Y-%m-%d').date()).days \
        if last_rain else None
    lc = str(cfg.get('last_cleaned', '') or '')
    days_clean = (today - datetime.strptime(lc, '%Y-%m-%d').date()).days \
        if lc else None

    # Massgebend: die juengere der beiden "Reinigungen" (Regen oder manuell)
    eff = min([d for d in (days_rain, days_clean) if d is not None], default=None)
    if eff is None:
        status, text = 'unknown', 'Keine Regen-/Reinigungsdaten'
    elif eff >= 30:
        status, text = 'due', f'Reinigung FAELLIG ({eff} Tage kein Waschregen/Reinigung)'
    elif eff >= 14:
        status, text = 'soon', f'Bald reinigen ({eff} Tage seit letztem Waschregen/Reinigung)'
    else:
        status, text = 'ok', f'Module ok ({eff} Tage seit letztem Waschregen/Reinigung)'

    data = {
        'status': status, 'text': text, 'days': eff,
        'last_rain': last_rain, 'rain_mm_7d': round(rain_mm_7d, 1),
        'last_cleaned': lc or None, 'today': today.isoformat(),
    }
    _RAIN_CACHE['ts'] = now
    _RAIN_CACHE['data'] = data
    return jsonify(data)


# Cache fuer Tiden (Stormglass), 12 h - Free-Tier nur 10 Calls/Tag!
_TIDES_CACHE = {'ts': 0, 'data': None}
TIDES_TTL = 12 * 3600


@app.route('/tides')
def tides():
    """Tidenhoch/-niedrig fuer die naechsten 7 Tage (Stormglass /tide/extremes).
    API-Key (kostenloser Free-Tier: 10 Calls/Tag) in pv.json ('tides_api_key',
    Registrierung: dashboard.stormglass.io). 12-h-Cache -> ~2 Calls/Tag.
    Ohne Key/Fehler: leer -> Frontend zeigt die Zeile nicht."""
    import time as _time
    import datetime as _dt
    now = _time.time()
    if _TIDES_CACHE['data'] is not None and now - _TIDES_CACHE['ts'] < TIDES_TTL:
        return jsonify(_TIDES_CACHE['data'])

    cfg = dict(_PV_FALLBACK)
    cfg.update(load_json_cfg(PV_PATH, {}))
    key = str(cfg.get('tides_api_key', '') or '').strip()
    if not key:
        # NICHT cachen: Key kann ja gleich in pv.json eingetragen werden
        return jsonify({'daily': {}, 'error': 'no_key'})

    try:
        from zoneinfo import ZoneInfo
        ltz = ZoneInfo(cfg.get('timezone', 'Europe/Lisbon'))
    except Exception:
        ltz = _dt.timezone.utc

    daily = {}
    try:
        start = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(hours=6))
        end = start + _dt.timedelta(days=8)
        r = requests.get(
            'https://api.stormglass.io/v2/tide/extremes/point',
            params={
                'lat': cfg.get('latitude'), 'lng': cfg.get('longitude'),
                # ISO-Format "JJJJ-MM-TT HH:MM" (Stormglass-Konvention, UTC)
                'start': start.strftime('%Y-%m-%d %H:%M'),
                'end': end.strftime('%Y-%m-%d %H:%M'),
            },
            headers={'Authorization': key},
            timeout=20,
        )
        r.raise_for_status()
        j = r.json()
        station = ((j.get('meta') or {}).get('station') or {}).get('name')
        for e in (j.get('data') or []):
            raw = str(e.get('time', ''))
            # "2026-11-10 05:44" oder ISO mit Offset/Z
            iso = raw.replace(' ', 'T')
            if iso.endswith('Z'):
                iso = iso[:-1] + '+00:00'
            try:
                dt = _dt.datetime.fromisoformat(iso)
            except ValueError:
                continue
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=_dt.timezone.utc)
            loc = dt.astimezone(ltz)
            day = loc.strftime('%Y-%m-%d')
            daily.setdefault(day, []).append({
                't': loc.strftime('%H:%M'),
                'type': 'Hoch' if str(e.get('type', '')).lower() == 'high' else 'Niedrig',
                'h': e.get('height'),
            })
        for day in daily:
            daily[day].sort(key=lambda x: x['t'])
        data = {'daily': daily, 'error': None, 'station': station}
    except (requests.RequestException, ValueError) as e:
        # Fehler NICHT cachen (sonst bleibt z. B. ein Key-Problem 12 h haengen)
        return jsonify({'daily': {}, 'error': str(e)[:120]})
    _TIDES_CACHE['ts'] = now
    _TIDES_CACHE['data'] = data
    return jsonify(data)


@app.route('/pvconfig')
def pvconfig():
    """Editierbare PV-Prognose-Konfiguration (pv.json)."""
    cfg = dict(_PV_FALLBACK)
    cfg.update(load_json_cfg(PV_PATH, {}))
    return jsonify(cfg)


@app.route('/wetter')
def wetter():
    return send_from_directory('templates', 'wetter.html')


@app.route('/weather')
def weather():
    """EIN Datensatz (15 Tage stündlich, solXcept-Watt + alle Wetterfelder)
    für die WETTER-Seite; 30-min-Cache."""
    import time as _time
    data, err = _weather_dataset()
    if err:
        return jsonify({'error': err}), 502
    return jsonify(data)


@app.route('/forecast')
def forecast():
    """PV-Prognose (7 Tage) aus dem gemeinsamen 15-Tage-Datensatz."""
    import time as _time
    from datetime import datetime as _dt

    now = _time.time()
    cfg = dict(_PV_FALLBACK)
    cfg.update(load_json_cfg(PV_PATH, {}))
    data, err = _weather_dataset()
    if err:
        return jsonify({'error': err}), 502

    try:
        from zoneinfo import ZoneInfo
        ltz = ZoneInfo(cfg.get('timezone', 'Europe/Lisbon'))
    except Exception:
        ltz = _dt.timezone.utc
    today = _dt.now(ltz).strftime('%Y-%m-%d')

    times, watts, daily = [], [], []
    for i, t in enumerate(data['times']):
        if t[:10] >= today:
            times.append(t)
            watts.append(data['watts'][i])
    for d in data['daily']:
        if d['date'] >= today:
            daily.append(d)

    out = {
        'ort': cfg.get('ort'),
        'kwp': float(cfg.get('kwp', 0) or 0),
        'pr': float(cfg.get('performance_ratio', 1.0) or 1.0),
        'tilt': cfg.get('tilt'),
        'model': 'solXpect',
        'inverter': f"{cfg.get('inverter_power', 0)} W / {cfg.get('inverter_efficiency', 90)}%",
        'shade_below': cfg.get('shade_below_elevation', 0),
        'shade_from': cfg.get('shade_from', ''),
        'shade_percent': cfg.get('shade_percent', 0),
        'unit': 'W', 'times': times, 'watts': watts, 'daily': daily,
        'fetched_at': int(now),
    }
    return jsonify(out)


@app.route('/alarm')
def alarm():
    """Editierbare Alarm-/Flag-Konfiguration (alarm.json) fuer die Web-App."""
    return jsonify(load_alarm_config())


@app.route('/query')
def query():
    """InfluxDB-1.8-Proxy: nimmt ?q=...&epoch=ms entgegen, liefert JSON."""
    q = request.args.get('q', '')
    if not q:
        return jsonify({'error': 'missing q'}), 400
    try:
        r = requests.get(
            INFLUX_URL,
            params={'db': INFLUX_DB, 'q': q, 'epoch': 'ms', 'throttle': '0'},
            timeout=60,  # kWh-Summen über große Zeiträume brauchen länger
        )
        return (r.text, r.status_code, {'Content-Type': 'application/json'})
    except requests.RequestException as e:
        return jsonify({'error': str(e)[:200]}), 502


@app.route('/health')
def health():
    try:
        r = requests.get(INFLUX_URL, params={'db': INFLUX_DB, 'q': 'SELECT 1', 'epoch': 'ms'}, timeout=3)
        return jsonify({'ok': r.status_code == 200})
    except requests.RequestException:
        return jsonify({'ok': False}), 502


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
    app.run(host='0.0.0.0', port=port, threaded=True)
