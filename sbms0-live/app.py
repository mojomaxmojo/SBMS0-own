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
