# SBMS0 – Electrodacus Solar/BMS Monitoring-Stack

Automation & Monitoring für Electrodacus SBMS0 Komponenten.

## System

| Komponente | Wert |
|---|---|
| **Batterie** | **280 Ah / 24 V** (8s LiFePO4, ~6,72 kWh) |
| Logger | `sbms0-LiveLogger.py` – 1 Datapoint/Sekunde → InfluxDB 1.8 (+ eigene 1-Min-Mittelwerte) |
| Datenbank | InfluxDB, DB `SBMS`, RP `raw_1s` (365d, DEFAULT) + `downsampled_1m` (365d) |
| Visualisierung | **SBMS0 Live-Web** (Port 8090) – ohne Grafana |
| Kiosk | Chromium im Kiosk-Modus auf Touchscreen (DietPi-Autostart) |

## 🚀 Installation (DietPi auf Dell Wyse 3040) – EIN BefehL

```bash
git clone https://github.com/mojomaxmojo/SBMS0-own.git /home/SBMS0
cd /home/SBMS0
sudo bash install_all.sh              # Serial-Port: /dev/ttyUSB0 (Standard)
# oder mit anderem Serial-Port:
sudo bash install_all.sh /dev/ttyUSB1
```

`install_all.sh` installiert in einem Durchgang (idempotent, mehrfach ausführbar):

1. **Pakete:** InfluxDB 1.8 (InfluxData-Repo, DietPi-Repo wird erkannt), `python3-serial/influxdb/flask/requests`, Tools
2. **InfluxDB-Dienst** aktivieren/starten
3. **Datenbank `SBMS`** + Retention `raw_1s` (365d, DEFAULT) + `downsampled_1m` (365d) – kein Continuous Query, das Downsampling macht der Logger selbst
4. **Logger:** `SBMS-LiveLogger.service` (User `dietpi`, Gruppe `dialout`, gewählter Serial-Port)
5. **Live-Web:** `sbms0-live` + uPlot-Download + `SBMS-LiveWeb.service` (Port 8090)
6. **Chromium-Kiosk:** Chromium via `dietpi-software 113`, Kiosk-URL `http://localhost:8090` in `/boot/dietpi.txt`, Kiosk-Flags (kein Translate, keine Popups), Translate-Policy (`/etc/chromium/policies/managed/translate-off.json`)
7. **Selbsttests:** influxdb aktiv, Logger aktiv, Live-Web `/health`, Influx-Query – klare OK/FEHLER-Ausgabe

**Ein manueller Restschritt:** `dietpi-autostart` einmal → Option **11 „Chromium – Dedicated use without desktop"** wählen → reboot. Danach startet der Touchscreen direkt in die Steuerzentrale.

> **Kein Grafana:** Der Stack läuft komplett ohne Grafana (spart ~700 MB RAM auf 2-GB-Systemen).
> Die ehemaligen Grafana-Dashboard-JSONs liegen gesichert im Repo `mojomaxmojo/SBMS0`.

## Live-Web (eigene Kiosk-App)

| URL | Seite | Inhalt |
|---|---|---|
| `/` | START | Steuerzentrale mit Kacheln (Touch-Launcher) |
| `/live` | LIVE | 1-s-Aktualisierung: SOC, Leistung, Akku, 8 Zellbalken, Cell-Delta-Gauge, Flags, Today-Verlauf |
| `/calc` | BERECHNUNGEN | Today: Energy (kWh), Energy flow, Prognosen (Time to full/empty), Battery Levels, Cell-Verlauf (RAW 1s) |
| `/hist` | HISTORIE | Zeitraum frei wählbar (24 h–1 a, Default 30 d): Verläufe, Energie-Statistik, Zell-Minima, Cell-Delta |

- Technologie: Flask (Port 8090) + Influx-Query-Proxy + Vanilla-JS + uPlot
- Farben/Thresholds 1:1 aus den ehemaligen Grafana-Dashboards übernommen
- **Update der App:**
  ```bash
  cd /home/SBMS0 && git pull && sudo python3 install_liveweb.py
  sudo systemctl restart SBMS-LiveWeb
  ```
  Anschließend im Browser/Kiosk neu laden.

## Dienste

| Unit | Beschreibung |
|---|---|
| `SBMS-LiveWeb.service` | Live-Web-App (Flask, Port 8090) – User `dietpi` |
| `SBMS-LiveLogger.service` | 1-Hz-Logger → InfluxDB (+ 1-Min-Downsampling) – User `dietpi`, Gruppe `dialout` |

## Logger-Verhalten (`sbms0-LiveLogger.py`)

**Schreib-Logik (aktuell):**
- Es wird **nur geschrieben, wenn seit dem letzten Schreiben eine frische Serial-Zeile empfangen wurde** (`data_new`-Flag).
- Im Normalbetrieb (> 1 Serial-Zeile/s, SBMS0 sendet kontinuierlich) bleibt der **1-s-Takt** unverändert – 1 Messpunkt pro Sekunde in `raw_1s`.
- Bei Serial-Aussetzern (Kabel ab, SBMS0 aus, Störung) werden **keine erfundenen Duplikate** mehr geschrieben (früher: letzter Wert mit neuem Zeitstempel je Sekunde). Sobald wieder Daten kommen, wird sofort geschrieben.
- **Zeitstempel = Empfangszeit** der Serial-Zeile (`data_ts`), nicht die Schreibzeit → die 1-Minuten-Mittelwerte (`downsampled_1m`) sind präziser.
- `build_json_body()` wird pro Schreibvorgang nur 1× aufgebaut (vorher 2×) – weniger CPU/Allokation.
- Terminal-Anzeige (SSH) bleibt im 1-s-Takt.
- **CSV-Fallback** bei InfluxDB-Fehlern: pro Logger-Start entsteht `sbms_fallback_<Datum>.csv`
  im Projektordner; geschrieben wird **nur** bei fehlgeschlagenem Influx-Schreibvorgang.
  - Beim ersten echten Fehler wird einmalig eine Kopfzeile (28 Spalten) gesetzt →
    die Datei ist ohne Code-Kenntnis lesbar/importierbar.
  - Ungenutzte Dateien bleiben **0 Byte**. Prüfung auf echte Datenlücken:
    `ls -l sbms_fallback_*.csv | awk '$5>0'` (Ausgabe = Daten, die nicht in InfluxDB landeten).
- Plausibilitätsprüfungen (Gesamtspannung, SOC, Zellwerte) verwerfen kaputte Zeilen komplett.

## Wichtige Berechnungs-Formeln (BERECHNUNGEN)

- Energie: `sum(<Power W>) / 3600 / 1000` → kWh (bei 1 Hz-Daten)
- Time to full: `280 × (100 − SOC)/100 ÷ Ladestrom(A) × 60` → Minuten
- Time to empty: `280 × SOC/100 ÷ Entladestrom(A) × 60` → Minuten
- Kapazität **280 Ah** ist in den Time-to-Queries hart hinterlegt (6 Stellen).

## Kiosk-Details (DietPi / Dell Wyse 3040 Touchscreen)

- **Autostart:** `dietpi-autostart` → Option 11 „Chromium – Dedicated use without desktop"; URL steht in `/boot/dietpi.txt` (`SOFTWARE_CHROMIUM_AUTOSTART_URL`).
- **Auflösung:** `SOFTWARE_CHROMIUM_RES_X/Y` in `/boot/dietpi.txt` (hier 1920×1200).
- **Chromium-Flags:** `install_all.sh` schreibt `/var/lib/dietpi/dietpi-software/installed/chromium-autostart.sh` mit: `--kiosk --no-first-run --no-default-browser-check --disable-component-update --disable-infobars --disable-session-crashed-bubble --disable-features=Translate,TranslateUI,TranslateMessage --lang=de` (kein `--disable-gpu`!). Wird ggf. von DietPi-Updates überschrieben → `install_all.sh` erneut ausführen.
- **Translate-Policy:** `/etc/chromium/policies/managed/translate-off.json` (`TranslateEnabled: false`) – überlebt Updates.
- **Scrollbar:** via CSS verborgen, Touch-Scrollen bleibt aktiv.
- **Git-Permissions:** Falls `git pull` als `dietpi` mit „insufficient permission" fehlschlägt: `sudo chown -R dietpi:dietpi /home/SBMS0` (einmalig).

## Performance (Wyse 3040, 2 GB RAM)

- **Entscheidend: ohne Grafana** → ~700 MB RAM frei, Swap dauerhaft 0, Load dauerhaft < 1.
- Live-Web ist auf minimale Last optimiert: 1-s-`last()`-Queries (Punktzugriffe), LED-Balken werden einmalig erzeugt und nur umgefärbt, Chart-Updates getaktet (60 s / 2 min).
- Bei RAM-/Load-Anstieg über Tage: nächtlichen Reboot-Cron einplanen (z. B. `0 4 * * * /sbin/reboot`).
- Optional (noch nicht umgesetzt): Logger schreibt nur bei neuen Serial-Daten; Terminal-Render throtteln; `raw_1s`-Retention 365d → 60d.

## Bedienung am Touchscreen

- **START** (Steuerzentrale): große Kacheln für LIVE / BERECHNUNGEN / HISTORIE – direkter Einstieg per Finger.
- **Menüleiste** auf jeder Seite: `START | LIVE | BERECHNUNGEN | HISTORIE` (aktive Seite hervorgehoben).
- **LIVE**: aktualisiert jede Sekunde – SOC-Balken (Farbe = Zustand), Leistungen PV/Batterie/Verbrauch, Akku-Spannung/Strom/Temperaturen, 8 Zellspannungen als LED-Balken, Cell-Delta-Gauge (mV) und Monitor-Flags. Unten der Tagesverlauf der Leistungen (1-Min-Mittel) mit Hover-/Touch-Werten.
- **BERECHNUNGEN**: Energie heute (kWh), Energy-Flow-Chart, Prognosen Time to full/empty (zeigen statt „No data" einen Hinweis, wenn gerade nicht geladen/entladen wird), Battery Levels und Zell-Verlauf (RAW 1 s → Balancing-Ausschläge sichtbar).
- **HISTORIE**: Zeitraum oben wählen (24 h / 7 d / 30 d / 90 d / 1 a oder Von–Bis-Datum), darunter Verläufe mit Min/Mean/Max-Legende, Energie-Statistik, Zell-Minima und Cell-Delta-Gauge.
- **Scrollen** per Wischen; die Bildlaufleiste ist im Kiosk bewusst ausgeblendet.

## Ziel-System

Einziges Zielsystem ist **DietPi (Debian Trixie) auf Dell Wyse 3040** mit `install_all.sh` (eine Anweisung, ohne Grafana).
Entfernte Alt-Dateien: `install_dietpi.sh`, `SBMS_Pi_install.py`, `SBMS_Pi-IOT_install.py`, `SBMS-Logger.service`, `sbms0-SerialToInfluxDB.py` (nur DietPi/Wyse wird genutzt; aktiver Logger ist allein `sbms0-LiveLogger.py`).
