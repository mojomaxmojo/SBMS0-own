#!/usr/bin/env python3
"""
SBMS0 Live-Web – Install-Helper (DietPi)
========================================
- installiert flask (falls fehlt)
- kopiert sbms0-live/ nach /home/SBMS0/sbms0-live
- installiert + aktiviert systemd-Dienst SBMS-LiveWeb
Idempotent – kann mehrfach ausgeführt werden.

Aufruf: sudo python3 install_liveweb.py
"""

import os
import shutil
import subprocess
import sys

SRC = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(SRC, 'sbms0-live')  # Dateien liegen im Unterordner sbms0-live/
DST = '/home/SBMS0/sbms0-live'
UNIT_SRC = os.path.join(SRC, 'SBMS-LiveWeb.service')
UNIT_DST = '/etc/systemd/system/SBMS-LiveWeb.service'


def run(cmd, **kw):
    print('  $', ' '.join(cmd))
    return subprocess.run(cmd, check=False, **kw).returncode


def main():
    if os.geteuid() != 0:
        sys.exit('Bitte mit sudo ausführen.')

    print('== 1/4 flask + requests prüfen/installieren ==')
    for mod, apt_pkg in (('flask', 'python3-flask'), ('requests', 'python3-requests')):
        if run(['python3', '-c', f'import {mod}']) != 0:
            # Debian 13 (PEP 668): System-Python-Pakete nur über apt
            if run(['apt-get', 'install', '-y', apt_pkg]) != 0:
                print('  apt fehlgeschlagen – Fallback: pip mit --break-system-packages')
                run([sys.executable, '-m', 'pip', 'install', '--break-system-packages', mod])

    print('== 2/4 Dateien nach %s == ' % DST)
    if os.path.abspath(SRC) == os.path.abspath(DST):
        # Installer wurde direkt im Zielverzeichnis ausgeführt (git checkout) –
        # Dateien sind bereits am richtigen Ort.
        print('  Quelle == Ziel (git checkout) – Kopieren entfällt')
    else:
        os.makedirs(DST, exist_ok=True)
        for item in ('app.py', 'static', 'templates'):
            src = os.path.join(SRC, item)
            dst = os.path.join(DST, item)
            if os.path.isdir(src):
                shutil.rmtree(dst, ignore_errors=True)
                shutil.copytree(src, dst)
            else:
                shutil.copy2(src, dst)
    run(['chown', '-R', 'dietpi:dietpi', DST])

    print('== 2b/4 uPlot (Chart-Lib) herunterladen ==')
    uplot_js = os.path.join(DST, 'static', 'uplot.iife.min.js')
    uplot_css = os.path.join(DST, 'static', 'uplot.min.css')
    if not (os.path.exists(uplot_js) and os.path.exists(uplot_css)):
        run(['curl', '-sfL', '-o', uplot_js,
             'https://cdn.jsdelivr.net/npm/uplot@1.6.31/dist/uPlot.iife.min.js'])
        run(['curl', '-sfL', '-o', uplot_css,
             'https://cdn.jsdelivr.net/npm/uplot@1.6.31/dist/uPlot.min.css'])
        run(['chown', '-R', 'dietpi:dietpi', DST])
    else:
        print('  bereits vorhanden – ok')

    print('== 3/4 systemd-Dienst ==')
    shutil.copy2(UNIT_SRC, UNIT_DST)
    run(['systemctl', 'daemon-reload'])
    run(['systemctl', 'enable', '--now', 'SBMS-LiveWeb'])

    print('== 4/4 Selbsttest ==')
    import time
    time.sleep(2)
    rc = run(['curl', '-sf', 'http://localhost:8090/health'])
    if rc == 0:
        print('\nOK  ->  Live-Web läuft auf http://<dietpi-ip>:8090')
        print('     Kiosk-URL (dietpi.txt): http://localhost:8090')
    else:
        print('\nWARNUNG: /health nicht erreichbar – Logs mit:')
        print('  journalctl -u SBMS-LiveWeb -n 30')


if __name__ == '__main__':
    main()
