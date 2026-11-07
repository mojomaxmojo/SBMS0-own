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
    'ort': 'unbekannt', 'latitude': 37.169, 'longitude': -7.491,
    'kwp': 2.25, 'tilt': 0, 'azimuth': 180, 'performance_ratio': 0.75,
    'forecast_days': 7, 'service': 'open-meteo',
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
    Open-Meteo-Prognose fuer die letzten 7 Tage (+ heute)."""
    import json as _json
    from datetime import datetime, timedelta, timezone

    cfg = dict(_PV_FALLBACK)
    cfg.update(load_json_cfg(PV_PATH, {}))
    kwp = float(cfg.get('kwp', 0) or 0)
    pr = float(cfg.get('performance_ratio', 0.75) or 0.75)

    # --- Open-Meteo mit past_days=7: stündliche GHI, Rückrechnung ---
    try:
        r = requests.get(
            'https://api.open-meteo.com/v1/forecast',
            params={
                'latitude': cfg.get('latitude'),
                'longitude': cfg.get('longitude'),
                'hourly': 'shortwave_radiation',
                'past_days': 7, 'forecast_days': 1,
                'timezone': 'Europe/Berlin',
                'models': 'best_match',
            },
            timeout=15,
        )
        r.raise_for_status()
        raw = r.json()
        hourly = raw['hourly']
        times = hourly['time']
        ghi = hourly['shortwave_radiation']
    except (requests.RequestException, ValueError, KeyError) as e:
        return jsonify({'error': 'Open-Meteo nicht erreichbar: ' + str(e)[:150]}), 502

    # stündliche Prognose-kWh auf lokale Tage aufsummieren (Europe/Berlin-
    # Zeitstempel von Open-Meteo, ohne TZ-Suffix -> naiv parsen ok)
    fc_by_day = {}
    for t, g in zip(times, ghi):
        if g is None:
            continue
        day = t[:10]
        # kWh je Stunde = kWp * (GHI/1000) * PR
        fc_by_day[day] = fc_by_day.get(day, 0.0) + kwp * (g / 1000.0) * pr

    # --- REAL-Ertrag aus InfluxDB: stündliche kWh (raw_1s) ---
    # Europe/Lisbon (Portugal) via zoneinfo; Fallback: UTC
    try:
        from zoneinfo import ZoneInfo
        LOCAL_TZ = ZoneInfo(cfg.get('timezone', 'Europe/Lisbon'))
    except Exception:
        LOCAL_TZ = timezone.utc

    real_by_day = {}
    try:
        r2 = requests.get(
            INFLUX_URL,
            params={'db': INFLUX_DB, 'epoch': 'ms', 'throttle': '0',
                    'q': 'SELECT sum("PV Power W")/3600/1000 AS kwh FROM "raw_1s"."SBMS_Metrics" '
                         "WHERE \"Name\" = 'SBMS0a' AND time > now() - 8d GROUP BY time(1h) fill(null)"},
            timeout=30,
        )
        r2.raise_for_status()
        s = r2.json()['results'][0]['series'][0]
        for ts, kwh in s['values']:
            if kwh is None:
                continue
            day = datetime.fromtimestamp(ts / 1000, tz=LOCAL_TZ).strftime('%Y-%m-%d')
            real_by_day[day] = round(real_by_day.get(day, 0.0) + float(kwh), 3)
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

    return jsonify({'pr': pr, 'kwp': kwp, 'timezone': str(LOCAL_TZ), 'days': out[-8:]})
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
            if v is not None and float(v) >= 2.0:      # >= 2 mm = "Waschregen"
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


@app.route('/pvconfig')
def pvconfig():
    """Editierbare PV-Prognose-Konfiguration (pv.json)."""
    cfg = dict(_PV_FALLBACK)
    cfg.update(load_json_cfg(PV_PATH, {}))
    return jsonify(cfg)


@app.route('/forecast')
def forecast():
    """PV-Prognose (Open-Meteo): stündliche Watt + Tages-kWh, 7 Tage.
    Ergebnis wird 30 min prozessweit gecacht (spart Requests, Rate-Limits)."""
    import time as _time
    import json as _json

    now = _time.time()
    if _FC_CACHE['data'] is not None and now - _FC_CACHE['ts'] < FC_TTL:
        return jsonify(_FC_CACHE['data'])

    cfg = dict(_PV_FALLBACK)
    cfg.update(load_json_cfg(PV_PATH, {}))
    days = min(int(cfg.get('forecast_days', 7) or 7), 16)
    kwp = float(cfg.get('kwp', 0) or 0)
    pr = float(cfg.get('performance_ratio', 0.85) or 0.85)

    try:
        r = requests.get(
            'https://api.open-meteo.com/v1/forecast',
            params={
                'latitude': cfg.get('latitude'),
                'longitude': cfg.get('longitude'),
                'hourly': 'shortwave_radiation',
                'daily': 'shortwave_radiation_sum,sunrise,sunset',
                'forecast_days': days,
                'timezone': 'Europe/Berlin',
                'models': 'best_match',
            },
            timeout=15,
        )
        r.raise_for_status()
        raw = r.json()
    except (requests.RequestException, ValueError) as e:
        return jsonify({'error': 'Open-Meteo nicht erreichbar: ' + str(e)[:150]}), 502

    try:
        hourly = raw['hourly']
        times = hourly['time']                       # lokale ISO-Zeit (Europe/Berlin)
        ghi = hourly['shortwave_radiation']          # W/m2 horizontal (0-Grad-Dach!)

        # P(W) = kWp * GHI(W/m2) / 1000 * PR * 1000  ->  kWp * GHI * PR
        watts = [
            round(kwp * (g or 0) * pr, 1) if g is not None else None
            for g in ghi
        ]

        # Tages-Summen kWh: GHI Wh/m2 je Stunde * kWp/1000 * PR -> kWh je Stunde
        daily = []
        for i, d in enumerate(raw.get('daily', {}).get('time', [])):
            start = i * 24
            stop = start + 24
            seg = [g for g in ghi[start:stop] if g is not None]
            kwh = round(kwp * (sum(seg) / 1000.0) * pr, 2) if seg else 0.0
            daily.append({
                'date': d,
                'kwh': kwh,
                'kwh_m2': raw.get('daily', {}).get('shortwave_radiation_sum', [None] * (i + 1))[i],
                'sunrise': raw.get('daily', {}).get('sunrise', [''] * (i + 1))[i],
                'sunset': raw.get('daily', {}).get('sunset', [''] * (i + 1))[i],
            })

        data = {
            'ort': cfg.get('ort'),
            'kwp': kwp, 'pr': pr, 'tilt': cfg.get('tilt'),
            'unit': 'W', 'times': times, 'watts': watts, 'daily': daily,
            'fetched_at': int(now),
        }
    except (KeyError, TypeError, ValueError) as e:
        return jsonify({'error': 'Unerwartetes Open-Meteo-Format: ' + str(e)[:150]}), 502

    _FC_CACHE['ts'] = now
    _FC_CACHE['data'] = data
    return jsonify(data)


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
