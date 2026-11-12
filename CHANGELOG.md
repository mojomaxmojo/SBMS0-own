# CHANGELOG – Wichtige Änderungen

Wichtige Änderungen am SBMS0-Stack (aktives Repo `mojomaxmojo/SBMS0-own`;
Vorgänger war `mojomaxmojo/SBMS0-test`).
Vollständige Commit-Historie: `git log --oneline`.

## 2026-11-12 (30) – pv.local.json: git-sichere manuelle Overrides auf der Kiste

- User-Wunsch: pv.json-Werte auf der Kiste manuell pflegen, OHNE dass
  `git pull` sie überschreibt.
- **Neu:** `app.py` `load_pv_cfg()` – Override-Kette Defaults → pv.json (Repo)
  → `pv.local.json` (Kiste, gitignored). ALLE 8 cfg-Ladestellen (alerts,
  weather, pvcompare, pvhourly, rain, tides, pvconfig, forecast) nutzen
  jetzt `load_pv_cfg()`; `/pvconfig` zeigt den gemergten Stand.
- Vorlage im Repo: `pv.local.json.example` (nach /home/SBMS0/pv.local.json
  kopieren und anpassen). `.gitignore` um `pv.local.json` ergänzt.
- pv.json (Repo-Defaults) aktuell: performance_ratio 1.1, shade_percent 100.
- Restart nötig (app.py-Änderung).

## 2026-11-11 (29) – Prognose-Kalibrierung: Schatten AUS + Diffus 50 % + PR 1.3 + Stunden-Ende-Bewertung

- Befund (Tagesgang 08.–11.11.): Real lag an ALLEN 4 Tagen über Prognose
  (Faktor ~1,8–3,4), Peaks 565–914 W vs. Prognose-Max 191–596 W →
  systematisch zu niedrig, nicht Wetter-Timing.
- **Schatten AUS:** pv.json `shade_percent: 100 → 0` (Baum verschattet real
  nicht mehr; `shade_*`-Rest bleibt wirkungslos als Memory).
- **A:** `performance_ratio: 1.0 → 1.3` (Startwert; Feintune über die
  Ist-vs-Prognose-Tabelle auf PROGNOSE beobachten).
- **B:** `diffuse_efficiency: 40 → 50` (Broken Clouds / bedeckte Tage).
- **C:** `solar.py` `hourly_watts()`: Bewertung am Stunden-ENDE statt
  Stundenmitte (:30) – behebt das ~1 h zu späte Morgen-Starten der
  Prognose-Kurve (09./11.11.).
- Restart nötig (solar.py-Änderung); pv.json wirkt live.

## 2026-11-11 (28) – pv.json: Modul-Daten korrekt eingetragen (5x LONGi Hi-MO 6 Explorer 440 Wp)

- Modulbestand geklärt: 5x LONGi Hi-MO 6 (X6) Explorer LR5-54HTH-440M
  (440 Wp, 1722×1134 mm = 1,953 m²/Modul, HPBC, ~2 Jahre alt).
- pv.json: `kwp` 2,25 → **2,2** (5×440 W), `cells_area` 9,64 → **9,76** m²,
  `temp_coeff` −0,4 → **−0,29 %/K** (Datenblatt), `cells_efficiency` 22,5 % (passte).
- Degradation ~2 Jahre (1,5 % J1 + 0,4 %/a) ≈ 98 % STC – performance_ratio
  bleibt 1,0 (Feintune nur bei systematischer Abweichung, siehe Konventionen).
- Spezifikation im `_hinweis`-Block dokumentiert.

## 2026-11-11 (27) – FIX: 24-h-Chart X-Achse – uPlot-Key heißt "splits", nicht "split"

- Der Fix aus (24)/(25) wirkte nicht: uPlot-Achsen-Option heißt `splits`
  (Plural). `split` wurde stillschweigend ignoriert -> Default-Ticks
  (07:50, 09:18 ...) blieben. Jetzt `opts.axes[0].splits = (u) => u.data[0]`.
- Cache-Busting: weather.js v=38.

## 2026-11-11 (26) – FIX: HTML-Seiten werden nicht mehr gecacht (Kiosk-Update-Problem)

- Ursache für "keine Änderung trotz Update": Chromium-Cache hielt `wetter.html`
  (und andere Templates) fest -> altes Script-Tag (`?v=35`) wurde weiter
  geladen, selbst wenn der Server schon v=36/37 auslieferte.
- `app.py` `@app.after_request`: HTML-Antworten bekommen
  `Cache-Control: no-cache, no-store, must-revalidate` (+ Pragma/Expires).
  Statische Dateien (JS/CSS) bleiben gecacht – die laufen über das
  bewährte `?v=`-Cache-Busting.
- EINMALIG danach noch hart neu laden (Kiosk-Reboot reicht), danach ist
  jedes Update sofort nach `git pull` + Restart sichtbar.

## 2026-11-11 (25) – WETTER: 24-h-Chart X-Achse JEDE Stunde

- User-Wunsch: nicht alle 3 Stunden, sondern JEDE Stunde als Label
  (08:00, 09:00, 10:00 ...). `axes[0].split` liefert jetzt alle
  Datenpunkte (24 Labels) statt einer ~8er-Auswahl.
- Cache-Busting: weather.js v=37.

## 2026-11-11 (24) – WETTER: 24-h-Chart X-Achse immer volle Stunden

- `weather.js` `updateChart24()`: X-Achsen-Ticks jetzt direkt an den
  Stunden-Datenpunkten (`axes[0].split` aus `u.data[0]`, ~8 Labels) statt
  uPlot-Default-Ticks, die je nach Chart-Breite auf Minutenwerten (z. B.
  08:30) landen konnten. Achse zeigt jetzt immer 08:00, 09:00, 10:00 …
- Cache-Busting: weather.js v=36.

## 2026-11-10 (23) – HISTORIE: Standard-Zeitraum 30 d → 7 d

- User-Wunsch: HISTORIE öffnet standardmäßig mit 7 Tagen statt 30 Tagen.
- `hist.js`: `range.hours` 720 → 168, Init `setRangeHours(168)`.
- `hist.html`: Button „7 d" ist jetzt `active` statt „30 d"; Cache-Busting hist.js v=23.
- 30 d bleibt weiter über den Button wählbar.

## 2026-11-10 (22) – Standort geändert: Vila Real de Santo Antonio

- pv.json: ort/lat/lon auf Vila Real de Santo Antonio (37.1998, -7.4152,
  ~10 km östlich von Manta Rota). Alte Werte als Text im `_hinweis`-Block.
- Wirkt auf: Open-Meteo (Wetter/PV), solXcept-Sonnenstand, Stormglass-Tiden
  (Station wählt automatisch neu), IPMA-Warnfilter (bleibt Faro/Algarve).
  pv.json wird live gelesen – kein Restart nötig (30-min-Wettercache läuft aus).

## 2026-11-10 (21) – TEST-Wechsel: dwd_icon → dwd_icon_eu (pv.json)

- `rain_models` jetzt mit `dwd_icon_eu` (6,5 km, in ICON global eingebettet)
  statt `dwd_icon` (13 km global). 3–4 Tage beobachten (Tagesgang-Vergleich).
- Backup der bisherigen Zeile als Text im `_hinweis`-Block von pv.json
  (JSON hat keine Kommentare – `#`-Zeilen würden die ganze Datei invalidieren!).
- Kein Code-Change, nur Konfiguration.

## 2026-11-10 (20) – MET Norway komplett entfernt; Windrichtung als letzte Kachel-Zeile

- app.py: MET-Norway-Abruf (api.met.no) ENTFERNT – wurde nur für die
  gelöschte Vergleichszeile gebraucht, nichts anderes nutzt die Daten.
  Ein API-Call weniger pro 30-min-Refresh.
- Stunden-Kacheln: neue letzte Zeile `🧭 SSW` (Windrichtung, 16-Sektoren,
  aus best_match `wind_direction_10m`).
- Cache-Busting: weather.js v=35.

## 2026-11-10 (19) – MET-Vergleichszeile entfernt

- Die gedimmte MET-Norway-Zeile in den Stunden-Kacheln ist weg (User-Wunsch).
  MET-Daten werden serverseitig weiter geladen (app.py unverändert) – nur
  die Anzeigezeile ist raus. Der MET-Speed-Neuaufbau (Windrichtung) landete
  nie im Frontend und wurde mit entfernt.
- Cache-Busting: weather.js v=34.

## 2026-11-10 (18) – Stunden-Kacheln: MET-Zeile mit Windrichtung statt Speed

- MET-Vergleichszeile: `💨 30` (m/s→km/h Speed) entfernt, dafür **🧭 Windrichtung**
  (16-Sektor-Kompass: N, NNO, NO … SSW, SW …) aus best_match `wind_direction_10m`.
  Zeile jetzt: `MET 🌡 20° · 🧭 SSW · 🌧 0,3`.
- Cache-Busting: weather.js v=32.

## 2026-11-10 (17) – START-Seite entfernt, LIVE ist Standard

- `/` liefert jetzt direkt `live.html` (Kiosk-Autostart-URL localhost:8090
  landet ohne Umweg in LIVE). `start.html` gelöscht.
- START-Link aus der Topbar-Navigation aller Seiten entfernt
  (LIVE | BERECHNUNGEN | HISTORIE | PROGNOSE | WETTER).
- Auto-Return (5 min → /live) bleibt; install_all.sh-/README-Texte angepasst.

## 2026-11-10 (16) – Kiosk-Auto-Return: nach 5 min zurück auf LIVE

- `shared.js`: Auto-Return-Timer – 5 min ohne Berührung (Touch/Klick/Taste/
  Scroll) → Weiterleitung auf /live. Jede Interaktion setzt den Timer zurück.
  Auf /live selbst keine Weiterleitung (Endlosschleife vermeiden).
- start.html bindet shared.js jetzt ein (Auto-Return gilt damit auf ALLEN
  Seiten inkl. START). Cache-Busting: shared.js v=5.

## 2026-11-10 (15) – Tiden: Niedrigwasser (N) heller hervorgehoben

- Tiden-Zeile 7-Tage-Kacheln: `N HH:MM` jetzt hell/fett (`.tide-n`),
  `H HH:MM` bleibt gedimmt. Cache-Busting: style.css v=29, weather.js v=30.

## 2026-11-10 (14) – Schatten-Modell: Direkt vs. Diffus getrennt (Baum)

- Baum verschattet die Sonnenscheibe VOLL, aber Diffusstrahlung kommt durchs
  Laubdach. Vorher wurde der Schatten-Faktor auf die GESAMT-Einstrahlung
  angewendet (Diffus fälschlich mit 0).
- Neu: `shade_percent` (100) wirkt nur auf die Direktstrahlung;
  neuer Parameter `shade_diffuse_pct` (pv.json, Default 50) = Anteil Diffus
  unter Schatten. Rechnerisch: diffuse_eff ×= 1−(1−shade)×(1−frac).
- Bodenreflexion bleibt unverschattet (bei tilt=0 ohnehin 0).
- pv.json: `"shade_diffuse_pct": 50`.

## 2026-11-10 (13) – FIX: Schatten-Modell morgens (Tagesgang-Beweis 09.11.)

- Befund: `shade_below_elevation=12°` blockte die flache Sonne ZEITSYMMETRISCH
  (morgens UND abends). Real produzierte die Anlage am 09.11. aber ab ~06:53
  (100–200 W), Prognose zeite bis 08:21 Null → Modell-Bug, nicht Kalibrierung.
- Fix `solar.py` `_shade_factor()` – 3 Modi:
  1. nur `shade_below_elevation` → zeitsymmetrisch (wie bisher)
  2. nur `shade_from` → rein zeitbasiert (wie bisher)
  3. **BEIDE gesetzt → Schatten nur ab Uhrzeit UND unter Sonnenhöhe**
     (Nachmittagsschatten Baum; morgens unangetastet)
- `pv.json`: `shade_from: "12:00"` gesetzt (Nachmittagsschatten-Modus 3).
- 09.11.-Prognose wurde generell zu niedrig gerechnet (Sturm-Wolken kamen
  später als von den Modellen angenommen) → Wetter-Timing, NICHT kalibrieren.

## 2026-11-10 (12) – Mobil: SOC-Balken bleibt sichtbar

- Mobile Nur-Werte-Modus: Ausnahme für `#soc-panel .ledbar` – der SOC-
  LED-Balken bleibt (28 px kompakt), alle anderen LED-Bars bleiben aus.
  Cache-Busting: style.css v=28.

## 2026-11-10 (11) – Mobil-Support (Pixel 6a): Nur-Werte-Modus

- `@media (max-width: 520px)` in style.css: auf dem Handy zeigen LIVE & Co.
  **nur die wichtigsten Werte** – SOC-Zahl, Leistungen PV/Akku/Verbrauch,
  Akku V/A, Delta-Gauge (kompakt, 120 px), Flags/Fehler-Banner.
- AUSGEBLENDET auf Mobil: alle LED-Bars (Werte bleiben als Text),
  Zellbalken-Panel, Tages-Chart, 24-h-Gauge wird verkleinert statt weg.
- Sonstige Seiten: einspaltig, kompakte Topbar, WETTER/PROGNOSE-Kacheln
  stapeln, HISTORIE-Zellminima 2-spaltig.
- Kiosk (1920 px) unverändert – Media-Query greift erst unter 520 px.
  Cache-Busting: style.css v=27 (alle Templates).

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
