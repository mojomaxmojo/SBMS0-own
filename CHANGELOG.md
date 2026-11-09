# CHANGELOG – Wichtige Änderungen

Wichtige Änderungen am SBMS0-Stack (aktives Repo `mojomaxmojo/SBMS0-own`;
Vorgänger war `mojomaxmojo/SBMS0-test`).
Vollständige Commit-Historie: `git log --oneline`.

## 2026-11-10 (10) – FIX: Energie-Berechnung einheitlich + lueckenfest (zu hohe kWh)

**Ursache der zu hohen Werte (Audit):**
1. BERECHNUNGEN Erzeugt/Verbraucht nutzte `integral()` über raw_1s – das
   **interpoliert ALLE Lücken linear**, inkl. Wyse-aus-Nacht. War der letzte
   Abend-Punkt ≠ 0, entsteht Phantom-Energie für die ganze Nacht (genau die
   Bug-Klasse des alten 3,98-kWh-Bugs).
2. PROGNOSE „Real" und HISTORIE-Stats nutzten Stundenmittel × 1 h –
   **Teilstunden zählten als volle Stunde** (Boot mitten in der Stunde).
3. Drei Methoden, drei leicht verschiedene Zahlen für denselben Tag.

**Fix – EINE Methode überall:**
`Energie = Σ je Stunde (mean W × count(1-Min-Punkte)/60)` aus `downsampled_1m`.
- Minuten MIT Daten zählen, Lücken zählen NULL (kein Phantom)
- Teilstunden zählen anteilig (count/60)
- identisch zur bewährten Geladen/Entladen-Methode

Geändert: `calc.js` (Erzeugt/Verbraucht), `app.py` `/pvcompare` (Real-Ertrag),
`hist.js` (Energie-Stats PV/Verbrauch). Cache-Busting: calc.js v=16, hist.js v=22.

**Verifikation:** Nach dem Update müssen BERECHNUNGEN „Erzeugt heute",
PROGNOSE „Real (heute)" und HISTORIE „PV heute" (Zeitraum Von–Bis = heute)
NAHEZU IDENTISCH sein (±0,02 kWh durch Bucket-Grenzen).

## 2026-11-10 (9) – WETTER: Leerzeile zwischen normalem Wetter und Warnungen

- 7-Tage-Kacheln: `.w-space` (10 px) nach der 🌅-Zeile → optische Trennung
  vor ⚠ UNWETTER / ⛈ Gewitter / 🌊 Tiden. Cache-Busting: style.css v=26,
  weather.js v=29.

## 2026-11-10 (8) – WETTER: Zeilenreihenfolge 7-Tage-Kacheln

- Neue Reihenfolge: normale Wetter-Zeilen (Datum, kWh, Wind, Böen, Regen,
  ☀/UV/☁, Temp, Sicht/Feuchte, 🌅) → dann ⚠ UNWETTER → ⛈ Gewitter →
  🌊 Tiden als LETZTE Zeile.

## 2026-11-10 (7) – Fix: /tides lieferte 12 h lang "no_key" trotz Key

- Bug: Die no_key-Antwort wurde für 12 h in den Tiden-Cache geschrieben –
  nachträglich eingetragener Key wurde dadurch ignoriert. Jetzt werden
  **no_key- UND Fehler-Antworten nicht mehr gecacht** (nur erfolgreiche Daten).
- Restart genügt; pv.json wird ohnehin bei jedem Call frisch gelesen.

## 2026-11-10 (6) – Tiden: worldtides → Stormglass umgestellt

- worldtides.info ist NICHT kostenlos (100 Test-Credits, danach 3,99 $/Jahr) –
  durch User korrekt angemerkt. Umgestellt auf **Stormglass**
  (`/v2/tide/extremes/point`, Auth via `Authorization`-Header, Free-Tier
  10 Calls/Tag).
- Cache 6 h → **12 h** (~2 Calls/Tag, sicher unter Free-Limit).
- Fenster: ab (jetzt − 6 h) bis +8 Tage, UTC→Europe/Lisbon, je Tag sortiert;
  `station` aus meta wird mitgeliefert.
- pv.json: Hinweistext auf Stormglass-Registrierung angepasst
  (Key-Feld heißt weiter `tides_api_key`).

## 2026-11-10 (5) – WETTER: Tiden Hoch/Niedrig als letzte Zeile in 7-Tage-Kacheln

- Neuer Endpunkt `/tides` (app.py): Tidenhoch/-niedrig für 7 Tage via
  **worldtides.info** (`/api/v3?extremes`), 6-h-Cache (Free-Tier-Limit).
- **BENÖTIGT kostenlosen API-Key** in `pv.json` (`tides_api_key`, Registrierung:
  worldtides.info/developer). Ohne Key: `/tides` liefert `{'daily': {}, 'error':'no_key'}`
  → Zeile bleibt einfach weg (kein Fehler im Frontend).
- Anzeige: `🌊 H 07:32 · N 13:58 · H 19:47` (lokal, Europe/Lisbon; H=Hochwasser,
  N=Niedrigwasser), UTC→lokal konvertiert, je Tag sortiert.
- weather.js: `/tides` parallel zu /weather + /alerts geladen; Cache-Busting v=27.

## 2026-11-10 (4) – WETTER: 24-h-Chart (Median Wind/Böen/Niederschlag)

- Neues Panel auf WETTER zwischen Stunden-Kacheln und 7-Tage-Kacheln:
  uPlot-Liniendiagramm mit den **Median-Kurven über alle 4 Modelle** –
  Wind (hellblau) + Böen (orange) links in km/h, Niederschlag (blau) rechts in mm.
- Zeitfenster identisch zu den Stunden-Kacheln: 24 h ab aktueller Stunde.
- Datenquelle: bestehende `hourly.med`-Mediane aus `/weather` (kein neuer API-Call).
- wetter.html: uPlot-Script eingebunden; weather.js Cache-Busting v=26.

## 2026-11-10 (3) – WETTER: Median-Farbe gelb

- `.med` (hervorgehobener Median in Min–Median–Max, Tages- UND Stunden-Kacheln)
  von weiß auf **Grafana-Gelb `#f2cc0c`** geändert (bessere Lesbarkeit, passt zu
  Plus/Bilanz- und warn2-Farben). Keine Logik-Änderung.

## 2026-11-10 (2) – WETTER: Bewölkung in die ☀-Zeile der 7-Tage-Kacheln

- 7-Tage-Kacheln: `☁ %` aus der Regen-Zeile in die Sonnenstunden-Zeile
  verschoben → `☀ X h · UV Y · ☁ Z %`; Regen-Zeile enthält nur noch die
  Min–Median–Max-Werte. Keine Logik-Änderung.

## 2026-11-10 – WETTER: DWD ICON zurück + Median statt Max/Konfidenz

**Was geändert wurde:**

1. **DWD ICON wieder in `rain_models`** (pv.json): jetzt 4 Quellen
   `metno_seamless,dwd_icon,ecmwf_ifs025,meteofrance_arpege_europe`
   (war 2026-11-06 wegen 101-mm-Regen-Übertreibung entfernt, User-Wunsch).
2. **Anzeige Min–Median–Max** auf 7-Tage- UND Stunden-Kacheln (Regen mm,
   Wind/Böen km/h). Median hell/fett (`span class="med"`), Min/Max abgedunkelt.
   "↔ Modelle uneinig"-Zeile und "(unsicher)"-Markierungen ENTFERNT – die
   Spanne interpretiert der Nutzer selbst (Konfidenz-Logik abgeschafft).
3. **Unwetter-Warnungen NUR am Median**: Tages-⚠ ab `warn_gust_kmh`/`warn_rain_mm`
   vs. Median (vorher MAX!), oranger Stunden-Rahmen ab `warn_gust_hourly_kmh`
   vs. Median-Böen (vorher MAX). Warntext mit "(Median)"-Zusatz.
4. Stunden-Mediane: `medianOf()` über alle 4 Modelle – HARMONIE-Vorzug entfernt.
5. Backend (`app.py`): statt `mix_*`/`conf_*`/`spread_*`/`*_median` jetzt
   `prec_min/med/max`, `gust_min/med/max`, `wind_min/med/max` je Tag (Dedupe-
   Gruppen `srcs`). `pv.json`: `spread_mid_pct`/`spread_warn_pct` entfernt.
6. Cache-Busting: style.css/weather.js → v=25 (alle Templates).

**Update auf der Kiste:** `git pull && sudo python3 install_liveweb.py && sudo systemctl restart SBMS-LiveWeb`

## 2026-11-06 – Alte Installer/Legacy-Logger entfernt (nur DietPi/Wyse)

- Gelöscht: `install_dietpi.sh` (alter Installer, von `install_all.sh` abgelöst),
  `sbms0-SerialToInfluxDB.py` (alter Logger, wurde nur von der bereits
  entfernten `SBMS-Logger.service` benutzt) und die Mitkopier-Zeile in
  `install_all.sh`.
- Kein Betriebssystembestandteil – `install_all.sh` deckt alles ab.

## 2026-11-06 – Pi-Installer entfernt (nur DietPi/Wyse wird genutzt)

- Gelöscht: `SBMS_Pi_install.py`, `SBMS_Pi-IOT_install.py`, `SBMS-Logger.service`
  (Legacy-Logger-Unit für User `pi`) – Zielsystem ist ausschließlich
  DietPi auf Dell Wyse 3040 via `install_all.sh`.
- `sbms0-SerialToInfluxDB.py` bleibt nur noch als Kompatibilitäts-/Referenzdatei
  (wird von `install_all.sh` ggf. nach /home/SBMS0 kopiert).

## 2026-11-06 – Grafana komplett aus allen Installern entfernt

- `install_dietpi.sh`: Grafana-Repo-Anlage, `apt install grafana`,
  systemd-Override, Datasource-Curl und Grafana-Statuszeilen entfernt.
  Neuer Abschnitt deinstalliert Grafana (`apt purge` + Verzeichnisse +
  Repo/Key), falls von früheren Läufen noch vorhanden.
- `SBMS_Pi_install.py`: Grafana-Repo, `apt install grafana`, Datasource
  (Port 3000) und Grafana-Hinweise entfernt; deinstalliert Reste ebenfalls.
- `SBMS_Pi-IOT_install.py`: tote Grafana-Datasource- und Port-3000-Reste entfernt.
- Doku (README/AGENTS) angepasst. Visualisierung weiterhin nur über
  SBMS-LiveWeb (Port 8090).

## 2026-11-06 – Repo-Umstellung: `SBMS0-test` → `SBMS0-own`

**Was geändert wurde:**

1. Clone-URL in `README.md` zeigt jetzt auf `mojomaxmojo/SBMS0-own`
   (das tatsächliche `origin` des Projekts).
2. `AGENTS.md`: Repo-Tabelle neu (aktiv = `SBMS0-own`, `SBMS0-test` =
   veralteter Vorläufer, `LeoAlioth/SBMS0` = Upstream-Basis) + Hinweis, dass
   das Projekt **kein GitHub-Fork** ist.
3. `CHANGELOG.md`: Repo-Angabe korrigiert.
4. **Remote `upstream` entfernt** (`LeoAlioth/SBMS0.git`): Das
   Shakespeare-Git-Panel zeigte daraus dauerhaft „This branch is 152 commits
   ahead of master". Es existiert jetzt nur noch `origin`
   (`SBMS0-own`), damit keine Vergleichsbasis mehr da ist.
   Wiederherstellen (nur bei Bedarf):
   `git remote add upstream https://github.com/LeoAlioth/SBMS0.git && git fetch upstream`

**Hintergrund:** GitHub meldete in Vergleichsansichten
„152 commits ahead of LeoAlioth:master". Das ist historisch korrekt
(35 Upstream-Commits von 2023 + 152 eigene) und **kein Fehler**: es sind
0 Commits „behind", also nichts zu mergen. Die Zahl selbst lässt sich nicht
„entfernen", ohne die Historie zu zerstören – siehe AGENTS.md.

## 2026-11-06 – Historie auf einen Root-Commit zusammengefasst + .gitignore

**Kontext:** Um die GitHub-Contributor-Liste zu bereinigen (vorher:
`shakespeare-diy`, `Burtond`, `LeoAlioth`), wurde die 189-Commit-Historie
durch **einen** Root-Commit (`9d5baf9`) ersetzt und per force-push
(`981b0cd...9d5baf9`) hochgeladen. Der Inhalt ist **byte-identisch**
(`git diff --stat` alt→neu leer). Die alte Historie liegt als
`SBMS0-historie.bundle` lokal und vollständig im Repo `mojomaxmojo/SBMS0-test`.

**Wichtig für andere Klone (DietPi `/home/SBMS0`):**
```bash
git remote set-url origin https://github.com/mojomaxmojo/SBMS0-own.git
git fetch origin && git reset --hard origin/master
```
Ohne Reset scheitert der nächste `git pull` (divergente Historien).

**Neu:**

1. **`.gitignore`** – `sbms0-live/static/uplot.*` (von `install_liveweb.py`
   geladen), `sbms_fallback_*.csv` (Messdaten), `__pycache__/`, `*.pyc`, `.venv/`.
2. **CSV-Fallback mit Kopfzeile** (`sbms0-LiveLogger.py`):
   - neue Konstante `CSV_HEADER` (28 Spalten, Reihenfolge = `row` in `main()`).
   - Kopfzeile wird **beim ersten Fehler-Schreibvorgang** einmalig gesetzt
     (nicht beim Start) → ungenutzte Fallback-Dateien bleiben 0 Byte, damit
     `ls -l sbms_fallback_*.csv | awk '$5>0'` weiterhin zuverlässig echte
     Datenlücken zeigt.

## 2026-11-06 – Logger: ehrliche Schreib-Logik (`sbms0-LiveLogger.py`)

**Kommentar:** db43502..aa15e83 („Logger-Optimierung")

**Was geändert wurde:**

1. **Schreiben nur bei frischer Serial-Zeile** – neues `data_new`-Flag:
   - Wird beim erfolgreichen `parse_line()` gesetzt, nach dem Schreiben zurückgesetzt.
   - Ohne frische Zeile wird der Schreib-Tick übersprungen.
2. **Keine Duplikate mehr bei Serial-Aussetzern:**
   - Vorher: letzter Wert wurde jede Sekunde mit **neuem** Zeitstempel geschrieben
     (erfundene Punkte bei Kabel ab / SBMS0 aus / Störung).
   - Nachher: Lücke in der Datenreihe – sobald Daten wieder kommen, wird sofort geschrieben.
3. **Zeitstempel = Empfangszeit** der Serial-Zeile (`data_ts`), nicht die Schreibzeit
   → präzisere 1-Minuten-Mittelwerte in `downsampled_1m`.
4. **`build_json_body()` nur 1× pro Schreibvorgang** (vorher 2×) – weniger CPU/Allokation.

**Unverändert:**
- 1-s-Takt im Normalbetrieb (SBMS0 sendet kontinuierlich)
- Terminal-Anzeige (SSH) im 1-s-Takt
- CSV-Fallback bei InfluxDB-Fehlern
- Plausibilitätsprüfungen (Gesamtspannung, SOC) verwerfen kaputte Zeilen komplett

**Verifikation:** `SELECT count("State of Charge") ... time > now() - 5m` →
Punktzahl entspricht jetzt der **echten** Sendefrequenz des SBMS0
(messbar ~0,68/s → ~204 Punkte in 5 min, da das SBMS0 im Schnitt alle ~1,5 s sendet).

**Hinweis:** Die Punktezahl kann daher niedriger sein als vor der Änderung –
das ist korrekt: früher waren ein Teil der Punkte Duplikate.

---

## 2026-11-05/06 – Live-Web ersetzt Grafana im Kiosk

**Was neu ist (`sbms0-live/`):**
- Eigene Web-App (Flask, Port 8090) statt Grafana im Kiosk:
  - `/` START (Steuerzentrale-Kacheln)
  - `/live` LIVE (1-s-Aktualisierung)
  - `/calc` BERECHNUNGEN (Today)
  - `/hist` HISTORIE (Zeitraum frei wählbar, Default 30 d)
- Farben/Thresholds 1:1 aus den ehemaligen Grafana-Dashboards
- uPlot-Charts (RAW 1s für Cell-Verlauf → Balancing-Spitzen sichtbar)

**Wichtige Learnings (für Wiederaufbau relevant):**
- Port **8090** (8088 = InfluxDB-RPC-Backup-Port, belegt)
- Grafana-Panel-Zeit-Override: modernes Grafana braucht `timeFrom`, legacy-`time`-Block wirkt nicht
- InfluxDB-Plugin: Cell-Beschriftungen nur sauber über `alias: "$col"`
  (Transformationen reichen nicht)
- InfluxQL-Zeitfilter: **Nanosekunden-Integer** (`time > 1793…`), keine `ms`-Literale
- Template-Literale in JS-Query-Strings frieren den Zeitraum beim Script-Load ein
  → Queries als Funktionen bauen
- uPlot: alte Charts `destroy()` vor Neuaufbau, sonst DOM-Stapel;
  `dash: [0,10]` zeichnet nichts (SOC-Punkte statt Dash); Achsenbreite explizit setzen
  (sonst fehlt bei „26.50 V" die führende 2)

**Effekt (Wyse 3040, 2 GB RAM):**
- Grafana schlafend (`systemctl disable --now grafana-server`): ~700 MB RAM frei,
  Swap 0 statt 163 MB voll, Load < 1 statt aufsteigend bis 10

## 2026-11-05 – Kiosk-Setup dokumentiert & fixiert

- Chromium-Kiosk: Flags in `/var/lib/dietpi/dietpi-software/installed/chromium-autostart.sh`
  (`--kiosk --no-first-run ... --disable-features=Translate,TranslateUI,TranslateMessage --lang=de`)
- Translate-Policy: `/etc/chromium/policies/managed/translate-off.json` (`TranslateEnabled: false`)
  – überlebt DietPi-Updates
- Scrollbar via CSS verborgen (Touch-Scrollen bleibt)
- Kiosk-URL: `/boot/dietpi.txt` → `SOFTWARE_CHROMIUM_AUTOSTART_URL=http://localhost:8090`

## 2026-11-05 – Dashboard-Optimierungen (Grafana-Ära, für Archiv notiert)

- Cells-Delta-Gauge: `last("Cell Delta") * 1000` mit 5-s-Fenster
  (statt 1m-Gruppierung über 600 Rohpunkte) → Load-Effekt 8.93 → ~0.5
- Refresh 3 s → 5 s, Chromium-Neustart → Load stabil
- Cell-Beschriftungen über `alias: "$col"` (ohne `SBMS_Metrics.`-Präfix)
- Time to full/empty: Hinweistext statt „No data" (Status-Serie + Value-Mapping)
