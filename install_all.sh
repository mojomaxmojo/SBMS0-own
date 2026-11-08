#!/bin/bash
# ==============================================================================
# SBMS0-Stack Komplett-Installer (ohne Grafana)
#
# Installiert EINMALIG den kompletten Monitoring-Stack:
#   1. System-Pakete (InfluxDB 1.8, Python-Module, Tools)
#   2. InfluxDB-Dienst + DB "SBMS" + Retention-Policies
#   3. SBMS-LiveLogger (1 Hz -> InfluxDB, inkl. 1-Min-Downsampling)
#   4. SBMS-LiveWeb (eigene Kiosk-App, Port 8090)
#   5. Chromium-Kiosk (Touchscreen-Autostart auf http://localhost:8090)
#
# KEIN Grafana: Die Visualisierung laeuft ueber Live-Web.
#
# Idempotent: kann mehrfach ausgeführt werden.
#
# Aufruf:   sudo bash install_all.sh
# Optional: sudo bash install_all.sh /dev/ttyUSB1     (Serial-Port, Default /dev/ttyUSB0)
# ==============================================================================
set -u

SBMS_DIR="/home/SBMS0"
RUN_USER="dietpi"
SERIAL_PORT="${1:-/dev/ttyUSB0}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIVEWEB_PORT="8090"

echo "=============================================================="
echo " SBMS0-Stack Installer (ohne Grafana)"
echo "=============================================================="

if [ "$EUID" -ne 0 ]; then
  echo "Bitte mit sudo ausführen:  sudo bash install_all.sh"
  exit 1
fi

# ------------------------------------------------------------------------------
# 1/8 - Repositories + Pakete
# ------------------------------------------------------------------------------
echo ">>> [1/8] Repositories + Pakete ..."

# DietPi bringt das InfluxDB-Repo bereits mit – Duplikate entfernen:
for f in /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
  [ -f "$f" ] || continue
  if grep -q "repos.influxdata.com" "$f" 2>/dev/null; then
    if grep -q "dietpi-influxdb" "$f" 2>/dev/null; then
      echo "    DietPi-InfluxDB-Repo gefunden: $f - ok"
      DIETPI_INFLUX=1
    else
      echo "    Entferne doppeltes InfluxDB-Repo: $f"
      rm -f "$f"
    fi
  fi
done
rm -f /etc/apt/trusted.gpg.d/influxdata.gpg /etc/apt/keyrings/influxdata.gpg

# Fallback (reines Debian ohne DietPi): InfluxData-Repo anlegen
if [ -z "${DIETPI_INFLUX:-}" ] && ! grep -rqs "repos.influxdata.com" /etc/apt/sources.list 2>/dev/null; then
  echo "    Lege InfluxData-Repo an ..."
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://repos.influxdata.com/influxdata-archive.key \
    | gpg --dearmor -o /etc/apt/keyrings/influxdata.gpg
  echo "deb [signed-by=/etc/apt/keyrings/influxdata.gpg] https://repos.influxdata.com/debian bookworm stable" \
    > /etc/apt/sources.list.d/influxdb.list
fi

apt-get update -qq
apt-get install -y -qq \
  influxdb \
  python3-serial \
  python3-influxdb \
  python3-flask \
  python3-requests \
  fonts-noto-color-emoji \
  curl gnupg git jq

python3 -c "import serial, influxdb, flask, requests" \
  && echo "    Python-Module OK (serial, influxdb, flask, requests)" \
  || { echo "FEHLER: Python-Module fehlen!"; exit 1; }

# ------------------------------------------------------------------------------
# 2/8 - InfluxDB: Dienst + Datenbank + Retention
# ------------------------------------------------------------------------------
echo ">>> [2/8] InfluxDB-Dienst ..."
systemctl enable --now influxdb
sleep 5

echo ">>> [3/8] Datenbank SBMS + Retention-Policies ..."
influx -database SBMS -execute "CREATE DATABASE SBMS WITH DURATION 365d REPLICATION 1" 2>/dev/null \
  && echo "    DB angelegt" || echo "    DB existiert bereits - ok"
influx -database SBMS -execute "CREATE RETENTION POLICY \"raw_1s\" ON \"SBMS\" DURATION 365d REPLICATION 1 DEFAULT" 2>/dev/null \
  && echo "    Retention raw_1s angelegt" || echo "    Retention raw_1s existiert bereits - ok"
influx -database SBMS -execute "CREATE RETENTION POLICY \"downsampled_1m\" ON \"SBMS\" DURATION 365d REPLICATION 1" 2>/dev/null \
  && echo "    Retention downsampled_1m angelegt" || echo "    Retention downsampled_1m existiert bereits - ok"
echo "    (Downsampling macht der LiveLogger selbst - kein Continuous Query noetig)"

# ------------------------------------------------------------------------------
# 4/8 - SBMS-LiveLogger
# ------------------------------------------------------------------------------
echo ">>> [4/8] SBMS-LiveLogger ..."

# Repo-Dateien liegen ggf. bereits in $SBMS_DIR (git checkout) – sonst kopieren:
if [ "$SCRIPT_DIR" != "$SBMS_DIR" ]; then
  mkdir -p "$SBMS_DIR"
  cp -f "$SCRIPT_DIR/sbms0-LiveLogger.py" "$SBMS_DIR/"
  cp -f "$SCRIPT_DIR/alarm.json" "$SBMS_DIR/" 2>/dev/null || true
  cp -f "$SCRIPT_DIR/pv.json" "$SBMS_DIR/" 2>/dev/null || true
fi

if id "$RUN_USER" &>/dev/null; then
  usermod -aG dialout "$RUN_USER" 2>/dev/null && echo "    $RUN_USER zur Gruppe dialout hinzugefuegt"
fi
git config --global --add safe.directory "$SBMS_DIR" 2>/dev/null || true
chown -R "$RUN_USER":"$RUN_USER" "$SBMS_DIR" 2>/dev/null || true

# Serial-Port in der Unit berücksichtigen (Argument, Default ttyUSB0):
cat > /etc/systemd/system/SBMS-LiveLogger.service <<EOF
[Unit]
Description=SBMS0 Serial LiveLogger (1 Hz -> InfluxDB)
After=network.target influxdb.service
Requires=influxdb.service

[Service]
User=${RUN_USER}
ExecStart=/usr/bin/python3 ${SBMS_DIR}/sbms0-LiveLogger.py ${SERIAL_PORT}
Restart=always
RestartSec=10
SyslogIdentifier=SBMS

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable SBMS-LiveLogger
if [ -e "$SERIAL_PORT" ]; then
  systemctl restart SBMS-LiveLogger
  echo "    Logger gestartet ($SERIAL_PORT gefunden)"
else
  echo "    Hinweis: $SERIAL_PORT nicht da - Logger startet beim naechsten Boot / nach Einstecken:"
  echo "             systemctl start SBMS-LiveLogger"
fi

# ------------------------------------------------------------------------------
# 5/8 - SBMS-LiveWeb (Kiosk-App)
# ------------------------------------------------------------------------------
echo ">>> [5/8] SBMS-LiveWeb (Port $LIVEWEB_PORT) ..."

if [ "$SCRIPT_DIR" != "$SBMS_DIR" ]; then
  rm -rf "$SBMS_DIR/sbms0-live"
  cp -r "$SCRIPT_DIR/sbms0-live" "$SBMS_DIR/sbms0-live"
fi

# uPlot (Chart-Lib) herunterladen, falls nicht vorhanden:
if [ ! -f "$SBMS_DIR/sbms0-live/static/uplot.iife.min.js" ]; then
  echo "    Lade uPlot herunter ..."
  curl -sfL -o "$SBMS_DIR/sbms0-live/static/uplot.iife.min.js" \
    https://cdn.jsdelivr.net/npm/uplot@1.6.31/dist/uPlot.iife.min.js
  curl -sfL -o "$SBMS_DIR/sbms0-live/static/uplot.min.css" \
    https://cdn.jsdelivr.net/npm/uplot@1.6.31/dist/uPlot.min.css
fi

chown -R "$RUN_USER":"$RUN_USER" "$SBMS_DIR"

cat > /etc/systemd/system/SBMS-LiveWeb.service <<EOF
[Unit]
Description=SBMS0 Live-Web (leichte Kiosk-Anzeige)
After=network.target influxdb.service
Wants=influxdb.service

[Service]
User=${RUN_USER}
WorkingDirectory=${SBMS_DIR}/sbms0-live
ExecStart=/usr/bin/python3 ${SBMS_DIR}/sbms0-live/app.py ${LIVEWEB_PORT}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now SBMS-LiveWeb
sleep 2

# ------------------------------------------------------------------------------
# 6/8 - Chromium-Kiosk
# ------------------------------------------------------------------------------
echo ">>> [6/8] Chromium-Kiosk ..."

if ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1; then
  echo "    Installiere Chromium via dietpi-software ..."
  /boot/dietpi/dietpi-software install 113
fi

# Autostart-URL + Aufloesung in /boot/dietpi.txt:
if [ -f /boot/dietpi.txt ]; then
  sed -i "s|^SOFTWARE_CHROMIUM_AUTOSTART_URL=.*|SOFTWARE_CHROMIUM_AUTOSTART_URL=http://localhost:${LIVEWEB_PORT}|" /boot/dietpi.txt
  grep -q "^SOFTWARE_CHROMIUM_AUTOSTART_URL=http://localhost:${LIVEWEB_PORT}" /boot/dietpi.txt \
    && echo "    Kiosk-URL gesetzt: http://localhost:${LIVEWEB_PORT}" \
    || echo "    WARNUNG: SOFTWARE_CHROMIUM_AUTOSTART_URL nicht gefunden - manuell pruefen!"
fi

# Chromium-Flags (kein Translate, kein Restore-Popup):
cat > /var/lib/dietpi/dietpi-software/installed/chromium-autostart.sh <<'CHROMEOF'
#!/bin/dash
# Autostart script for kiosk mode, based on https://github.com/MichaIng/DietPi/issues/1737
RES_X=$(sed -n '/^[[:blank:]]*SOFTWARE_CHROMIUM_RES_X=/{s/^[^=]*=//p;q}' /boot/dietpi.txt)
RES_Y=$(sed -n '/^[[:blank:]]*SOFTWARE_CHROMIUM_RES_Y=/{s/^[^=]*=//p;q}' /boot/dietpi.txt)

CHROMIUM_OPTS="--kiosk --window-size=${RES_X:-1280},${RES_Y:-720} --window-position=0,0 \
  --no-first-run --no-default-browser-check --disable-component-update --disable-infobars \
  --disable-session-crashed-bubble --disable-features=Translate,TranslateUI,TranslateMessage \
  --lang=de"

URL=$(sed -n '/^[[:blank:]]*SOFTWARE_CHROMIUM_AUTOSTART_URL=/{s/^[^=]*=//p;q}' /boot/dietpi.txt)

STARTX='xinit'
[ "$USER" = 'root' ] || STARTX='startx'

exec "$STARTX" /usr/bin/chromium $CHROMIUM_OPTS "${URL:-https://dietpi.com/}"
CHROMEOF
chmod +x /var/lib/dietpi/dietpi-software/installed/chromium-autostart.sh
echo "    Chromium-Flags gesetzt (kiosk, kein Translate, keine Popups)"

# Translate-Policy (hart, ueberlebt auch DietPi-Updates):
mkdir -p /etc/chromium/policies/managed
printf '{ "TranslateEnabled": false }\n' > /etc/chromium/policies/managed/translate-off.json
echo "    Translate-Policy installiert (/etc/chromium/policies/managed/translate-off.json)"

# ------------------------------------------------------------------------------
# 7/8 - Selbsttests
# ------------------------------------------------------------------------------
echo ">>> [7/8] Selbsttests ..."
sleep 2
TESTS_OK=1

systemctl is-active --quiet influxdb \
  && echo "    OK  influxdb aktiv" || { echo "    FEHLER influxdb"; TESTS_OK=0; }

systemctl is-active --quiet SBMS-LiveLogger \
  && echo "    OK  SBMS-LiveLogger aktiv" || echo "    HINWEIS SBMS-LiveLogger inaktiv (Serial-Port da?)"

curl -sf "http://localhost:${LIVEWEB_PORT}/health" > /dev/null \
  && echo "    OK  SBMS-LiveWeb /health" || { echo "    FEHLER SBMS-LiveWeb (journalctl -u SBMS-LiveWeb -n 30)"; TESTS_OK=0; }

influx -database SBMS -execute "SELECT 1" >/dev/null 2>&1 \
  && echo "    OK  InfluxDB-Query" || { echo "    FEHLER InfluxDB-Query"; TESTS_OK=0; }

# ------------------------------------------------------------------------------
# 8/8 - Abschluss
# ------------------------------------------------------------------------------
IP=$(hostname -I | awk '{print $1}')
echo ""
echo "=============================================================="
if [ "$TESTS_OK" -eq 1 ]; then
  echo " FERTIG - System laeuft!"
else
  echo " FERTIG, ABER FEHLER (siehe oben) - bitte pruefen!"
fi
echo ""
echo "  Live-Web : http://${IP}:${LIVEWEB_PORT}   (START-Steuerzentrale)"
echo "             /live  /calc  /hist"
echo "  Logger   : journalctl -u SBMS-LiveLogger -f"
echo "  Updates  : cd ${SBMS_DIR} && git pull && sudo python3 install_liveweb.py"
echo "  Kiosk    : dietpi-autostart -> 'Chromium - Dedicated use' (einmalig waehlen), dann reboot"
echo "=============================================================="
