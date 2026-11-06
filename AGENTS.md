# AGENTS.md – Kontext für KI-Agenten (SBMS0-Stack)

> Lies diese Datei zuerst! Sie fasst alles zusammen, was du über dieses Projekt
> wissen musst, bevor du Änderungen machst. Bei neuen wichtigen Erkenntnissen:
> **diese Datei aktualisieren** (und `CHANGELOG.md` ergänzen).

## Was ist das?

Monitoring-Stack für einen **Electrodacus SBMS0** Solar-Batterie-Controller
(8s LiFePO4, 280 Ah / 24 V, ~6,72 kWh). Ein Python-Logger liest den SBMS0 über
USB/Serial und schreibt 1 Hz in InfluxDB 1.8; eine eigene, leichte Web-App
(Live-Web) zeigt alles auf einem Touchscreen-Kiosk (Chromium auf DietPi).

**Wichtig:** Grafana wurde ersetzt und ist bewusst OUT (nicht installiert /
schlafend gelegt, ~700 MB RAM-Ersparnis). Die alten Grafana-Dashboard-JSONs
liegen konserviert im Repo `mojomaxmojo/SBMS0` (Zweig der Referenz) – hier im
Test-Repo wurden sie entfernt.

## Repos (bewusst getrennt)

| Repo | Zweck |
|---|---|
| `mojomaxmojo/SBMS0-own` | **Aktives Projekt**: Live-Web, Logger, Installer (dieses Repo) |
| `mojomaxmojo/SBMS0-test` | **Nur Historie** (189 Commits bis 2026-11-06). Nicht mehr klonen/pullen! |
| `mojomaxmojo/SBMS0` | **Archiv/Referenz**: enthält die alten Grafana-Dashboards + `setup_alert.sh` |
| `LeoAlioth/SBMS0` | Ursprüngliches Upstream-Projekt (letzter Commit 03/2023) – kein Remote mehr |

Origin des aktiven Repos: `https://github.com/mojomaxmojo/SBMS0-own.git`
(git push kann gelegentlich HTTP 429 liefern → kurz warten, erneut pushen).

### Historie: seit 2026-11-06 EIN Root-Commit

Das aktive Repo hat **genau einen Commit** (`9d5baf9`, „SBMS0 Monitoring-Stack:
Live-Web, Logger, Installer"). Die vorherige 189-Commit-Historie (154 ×
`shakespeare.diy`, 31 × `Burtond`, 4 × `Anže Košir`) wurde per force-push
zusammengefasst, um die GitHub-Contributor-Liste zu bereinigen. Der Inhalt ist
**byte-identisch** (`git diff --stat` alt→neu war leer).

- Alte Historie: `SBMS0-historie.bundle` (lokal beim User) **und** vollständig im
  Repo `mojomaxmojo/SBMS0-test`.
- Alte Commit-Hashes (z. B. in älteren CHANGELOG-Einträgen) sind in diesem Repo
  **nicht mehr auflösbar** – nicht als Fehler interpretieren.
- **Andere Klone (DietPi `/home/SBMS0`) müssen einmalig**:
  ```bash
  git remote set-url origin https://github.com/mojomaxmojo/SBMS0-own.git
  git fetch origin && git reset --hard origin/master
  ```
  Ohne das pullt die Kiste weiter aus `SBMS0-test` (genau so passiert am
  2026-11-06) und/oder scheitert an divergenter Historie.

**Einziger Remote ist `origin`.** Der frühere Remote `upstream`
(`https://github.com/LeoAlioth/SBMS0.git`) wurde am 2026-11-06 **entfernt**,
weil das Shakespeare-Git-Panel daraus dauerhaft „152 commits ahead of master"
anzeigte. Das Git-Repo hat nur noch `refs/remotes/origin/*`.
Nur falls die Upstream-Historie wirklich gebraucht wird, wieder hinzufügen:

```bash
git remote add upstream https://github.com/LeoAlioth/SBMS0.git && git fetch upstream
```

## Architektur

```
SBMS0 (USB/Serial, 921600 baud)
  └─> sbms0-LiveLogger.py  (1 Hz → InfluxDB raw_1s; schreibt selbst 1-Min-Mittelwerte
       systemd: SBMS-LiveLogger.service        nach downsampled_1m – KEIN Continuous Query!)
  └─> InfluxDB 1.8, DB "SBMS"
       RPs: raw_1s (365d, DEFAULT), downsampled_1m (365d)
  └─> sbms0-live/app.py  (Flask, Port 8090)
       systemd: SBMS-LiveWeb.service
       /      = START (Steuerzentrale-Kacheln)
       /live  = LIVE (1s)
       /calc  = BERECHNUNGEN (Today)
       /hist  = HISTORIE (Zeitraum frei, Default 30d)
       /query = Influx-Query-Proxy (löst CORS)
  └─> Chromium-Kiosk (Touchscreen, autostartet http://localhost:8090)
```

- Zeitreihen-Zeitfilter in InfluxQL immer mit **Nanosekunden-Integer**
  (`time > 1793…`), NICHT `...ms`-Literale.
- Der Logger schreibt nur bei **frischer Serial-Zeile** (`data_new`-Flag, seit
  2026-11-06) – kein Aufüllen mit Duplikaten. Das SBMS0 sendet im Schnitt alle
  ~1,5 s → ~204 Punkte/5 min in `raw_1s` sind korrekt (früher ~300 mit Duplikaten).
- Grafana-Panel-Konventionen (Farben, Thresholds) wurden 1:1 ins Live-Web
  übernommen – Details in `CHANGELOG.md`.

## Wichtige Dateien

| Datei | Zweck |
|---|---|
| `install_all.sh` | Komplett-Installer (ohne Grafana): Pakete, InfluxDB, DB, Logger, LiveWeb, Kiosk. Idempotent. Serial-Port als Arg. |
| `install_liveweb.py` | Installiert/aktualisiert nur Live-Web (+ uPlot-Download) |
| `sbms0-live/` | Die Web-App (app.py, static/, templates/, Unit) |
| `sbms0-LiveLogger.py` | Der 1-Hz-Logger |
| `.gitignore` | uPlot-Dateien, `sbms_fallback_*.csv` (Messdaten), Python-Artefakte |
| `README.md` | Betriebs-Doku (Installation, Kiosk-Details, Performance) |
| `CHANGELOG.md` | Wichtige Änderungen + Learnings, neueste zuerst |

## Hartnäckige Fallstricke (bitte nicht neu erfinden!)

1. **Port 8090** für Live-Web – **8088 ist vom InfluxDB-RPC belegt**.
2. InfluxDB-Plugin/Grafana: Seriennamen `measurement.field` nur per
   `alias: "$col"` loswerden – Transformationen (renameByRegex) greifen nicht überall.
3. uPlot: alte Charts `destroy()` vor Neuaufbau (sonst DOM-Stapel);
   `dash: [0,10]` zeichnet nichts (Punkte nutzen); Achsenbreite explizit setzen
   (`size: 70`), sonst wird bei „26.50 V" die führende 2 abgeschnitten.
4. Grafana-Panel-Zeit-Override: modernes Grafana braucht `timeFrom`, der
   legacy-`time`-Block am Panel wirkt nicht.
5. JS-Queries als **Funktionen** bauen – Template-Literale frieren den Zeitraum
   beim Script-Load ein (`time > 0 AND time <= 0`-Bug).
6. DietPi überschreibt `chromium-autostart.sh` bei Updates → Flags + Policy
   (`/etc/chromium/policies/managed/translate-off.json`) per `install_all.sh` wiederherstellen.
7. Git-Permissions: falls `git pull` als `dietpi` „insufficient permission":
   `sudo chown -R dietpi:dietpi /home/SBMS0`.
8. Timezone beachten: „Today" = lokales Mitternacht (Epoch in ns in die Query).

## System-Umgebung

- **DietPi (Debian Trixie) auf Dell Wyse 3040**, 2 GB RAM, 4 Kerne, Touchscreen 1920×1200.
- Benutzer: `dietpi` (Userdienste), `root`/sudo für Installation.
- InfluxDB auf localhost:8086 (Queries), 8088 (RPC, belegt!).
- Update-Flow: `cd /home/SBMS0 && git pull && sudo python3 install_liveweb.py
  && sudo systemctl restart SBMS-LiveWeb` (+ ggf. `restart SBMS-LiveLogger` bei Logger-Änderungen).

## Konventionen / Verhalten

- **Immer auf Freigabe warten**, bevor Code geändert wird (User-Wunsch).
- Deutsch kommunizieren (User-Sprache).
- „No data"-Panels bekommen freundliche Hinweistexte statt leerem Zustand.
- Prognosen (Time to full/empty) nutzen eigene gleitende Zeitfenster
  (5m/1h/24h) – unabhängig vom Seiten-Zeitraum.
- Energie = `sum(<Power W>) / 3600 / 1000` kWh; Batterie **280 Ah** ist in den
  Time-to-Queries hart hinterlegt (6 Stellen im Repo).
- Farb-Thresholds: SOC 0/10/20/30/40/80/100-Stufen; Zellen 2,8/3,0/3,2/3,65 V
  (unter 2,8 V solid rot); Delta ≤20 mV grün, ≤50 orange, >50 rot.

## Noch offen / Ideen

- Nächtlicher Reboot-Cron für Kiosk (RAM-Optimierung, optional).
- `raw_1s`-Retention 365d → 60d (optional, Verläufe laufen über `downsampled_1m`).
- Logger: Terminal-Render-Throttle (bewusst bei 1 s belassen, User-Wahl).
