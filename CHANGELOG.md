# CHANGELOG – Wichtige Änderungen

Wichtige Änderungen am SBMS0-Stack (aktives Repo `mojomaxmojo/SBMS0-own`;
Vorgänger war `mojomaxmojo/SBMS0-test`).
Vollständige Commit-Historie: `git log --oneline`.

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
