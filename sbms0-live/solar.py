#!/usr/bin/env python3
"""
solXcept-Ertragsmodell für SBMS0-LiveWeb
========================================
1:1-Nachbau der Rechenlogik aus solXpect (SolarPowerPlant.java, GPLv3) bzw.
des Python-Ports github.com/blablubbbb/solXpect_meets_python – nur mit
eigenem Sonnenstands-Algorithmus (NOAA) statt pvlib (keine Extra-Abhängigkeiten).

Modell (je Stunde, bewertet zur Stundenmitte):
  - Sonnenstand (Azimut/Elevation) → Projektion der Direktstrahlung (DNI)
    auf die Modulfläche (Skalarprodukt, <0 = Sonne hinter dem Modul → 0)
  - Verschattungsfaktor (Zeit-basiert, konfigurierbar, z. B. ab 16:00 100 %)
  - Diffuse Strahlung × diffuse_efficiency (bei 0° Neigung ~100 %)
  - Bodenreflexion: GHI × (0.5 − 0.5·cos(Neigung)) × Albedo
  - Zelltemperatur: Ross-Modell  T = T_luft + 0.0342 × Einstrahlung
  - Temperatur-Derating: Faktor (1 + (Tzelle − 25) × temp_coeff)
  - DC = Einstrahlung × Faktor × Wirkungsgrad × Fläche
         (oder kWp/1000-Variante, wenn Fläche/η = 0)
  - AC = min(DC × WR-Wirkungsgrad, WR-Leistungslimit)

Eingangsdaten: Open-Meteo "direct_normal_irradiance, diffuse_radiation,
shortwave_radiation, temperature_2m" (UTC).
"""

import math
from datetime import datetime, timezone


# ----------------------------------------------------------------------------
# Sonnenstand (NOAA-Solarposition, gut auf ~0.1° genau – reicht für Ertrag)
# ----------------------------------------------------------------------------
def solar_position(ts_utc, lat, lon):
    """ts_utc: Unix-Sekunden. Rückgabe (elevation_deg, azimuth_deg N=0,O=90)."""
    jd = ts_utc / 86400.0 + 2440587.5          # Unix-Epoche -> Julianisches Datum
    t = (jd - 2451545.0) / 36525.0             # Julianisches Jahrhundert

    # Geometrische mittlere Sonnenlänge / Anomalie / Exzentrizität
    l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360.0
    m = 357.52911 + t * (35999.05029 - 0.0001537 * t)
    e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
    mr = math.radians(m)
    c = (math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t))
         + math.sin(2 * mr) * (0.019993 - 0.000101 * t)
         + math.sin(3 * mr) * 0.000289)
    true_long = l0 + c
    omega = 125.04 - 1934.136 * t
    lam = math.radians(true_long - 0.00569 - 0.00478 * math.sin(math.radians(omega)))

    eps0 = (23.0 + (26.0 + (21.448 - t * (46.8150 + t * (0.00059 - t * 0.001813))) / 60.0) / 60.0)
    eps = math.radians(eps0 + 0.00256 * math.cos(math.radians(omega)))

    decl = math.asin(math.sin(eps) * math.sin(lam))            # Deklination
    y = math.tan(eps / 2.0) ** 2

    # Zeitgleichung (Minuten)
    l0r = math.radians(l0)
    eqtime = 4.0 * (
        y * math.sin(2 * l0r)
        - 2 * e * math.sin(mr)
        + 4 * e * y * math.sin(mr) * math.cos(2 * l0r)
        - 0.5 * y * y * math.sin(4 * l0r)
        - 1.25 * e * e * math.sin(2 * mr)
    )

    dt = datetime.fromtimestamp(ts_utc, tz=timezone.utc)
    minutes = dt.hour * 60 + dt.minute + dt.second / 60.0
    true_solar_time = (minutes + eqtime + 4.0 * lon) % 1440.0
    ha = math.radians(true_solar_time / 4.0 - 180.0)           # Stundenwinkel

    latr = math.radians(lat)
    cos_zen = (math.sin(latr) * math.sin(decl)
               + math.cos(latr) * math.cos(decl) * math.cos(ha))
    cos_zen = max(-1.0, min(1.0, cos_zen))
    elevation = 90.0 - math.degrees(math.acos(cos_zen))

    az_from_south = math.atan2(
        math.sin(ha),
        math.cos(ha) * math.sin(latr) - math.tan(decl) * math.cos(latr))
    azimuth = (math.degrees(az_from_south) + 180.0) % 360.0    # 0 = Nord, cw
    return elevation, azimuth


# ----------------------------------------------------------------------------
# Anlage
# ----------------------------------------------------------------------------
class Plant:
    def __init__(self, cfg):
        self.latitude = float(cfg.get('latitude', 0))
        self.longitude = float(cfg.get('longitude', 0))
        self.kwp = float(cfg.get('kwp', 0) or 0)
        self.area = float(cfg.get('cells_area', 0) or 0)            # m²
        self.eff = float(cfg.get('cells_efficiency', 0) or 0) / 100.0
        self.temp_coeff = float(cfg.get('temp_coeff', -0.4) or 0) / 100.0
        self.diffuse_eff = float(cfg.get('diffuse_efficiency', 100) or 100) / 100.0
        self.albedo = float(cfg.get('albedo', 0.2) or 0)
        self.tilt = float(cfg.get('tilt', 0) or 0)
        self.azimuth = float(cfg.get('azimuth', 180) or 0)
        self.inv_limit = float(cfg.get('inverter_power', 0) or 0)
        self.inv_eff = float(cfg.get('inverter_efficiency', 90) or 90) / 100.0
        self.fine_tune = float(cfg.get('performance_ratio', 1.0) or 1.0)
        self.shade_below = float(cfg.get('shade_below_elevation', 0) or 0)  # Sonnenhöhe in °
        self.shade_from = str(cfg.get('shade_from', '') or '')      # Start-Uhrzeit "12:00"
        self.shade_percent = float(cfg.get('shade_percent', 100) or 100)
        # Anteil Diffusstrahlung, der DURCH die Verschattung kommt (Baum:
        # Sonnenscheibe voll blockt, Diffus kommt teils durchs Laubdach)
        self.shade_diffuse_frac = float(cfg.get('shade_diffuse_pct', 50) or 50) / 100.0
        self.timezone_name = cfg.get('timezone', 'Europe/Lisbon')

    def _shade_factor(self, elevation_deg, local_hhmm):
        """Verschattung, drei Modi:
        1. NUR shade_below_elevation  -> zeitsymmetrisch (morgens UND abends)
        2. NUR shade_from (HH:MM)     -> rein zeitbasiert ab dieser Uhrzeit
        3. BEIDE gesetzt              -> Verschattung nur ab Uhrzeit UND
           Sonnenhoehe unter der Grenze. Fuer Nachmittagsschatten (z. B. Baum),
           der morgens nicht existiert: Sonne morgens unangetastet.
        (Modus 3 seit 2026-11-10 – vorher blockte shade_below auch morgens,
         obwohl die Anlage real produzierte: Tagesgang-Beweis 09.11.)"""
        if self.shade_percent <= 0:
            return 1.0
        blocked = 1.0 - self.shade_percent / 100.0

        if self.shade_below > 0 and self.shade_from:
            # Kombiniert: Uhrzeit-Fenster + Sonnenhoehe
            try:
                from_h, from_m = self.shade_from.split(':')
                limit = int(from_h) * 60 + int(from_m)
                now_h, now_m = local_hhmm.split(':')
                if (int(now_h) * 60 + int(now_m)) < limit:
                    return 1.0            # vor dem Fenster: keine Verschattung
            except (ValueError, AttributeError):
                return 1.0
            return blocked if elevation_deg < self.shade_below else 1.0

        if self.shade_below > 0:
            return blocked if elevation_deg < self.shade_below else 1.0
        if self.shade_from:
            try:
                from_h, from_m = self.shade_from.split(':')
                limit = int(from_h) * 60 + int(from_m)
                now_h, now_m = local_hhmm.split(':')
                if (int(now_h) * 60 + int(now_m)) >= limit:
                    return blocked
            except (ValueError, AttributeError):
                return 1.0
        return 1.0
        blocked = 1.0 - self.shade_percent / 100.0
        if self.shade_below > 0:
            return blocked if elevation_deg < self.shade_below else 1.0
        if self.shade_from:
            try:
                from_h, from_m = self.shade_from.split(':')
                limit = int(from_h) * 60 + int(from_m)
                now_h, now_m = local_hhmm.split(':')
                if (int(now_h) * 60 + int(now_m)) >= limit:
                    return blocked
            except (ValueError, AttributeError):
                return 1.0
        return 1.0

    def get_power(self, dni, dif, ghi, ambient_temp, ts_utc, local_hhmm):
        """AC-Leistung (W) für die Stunde, bewertet zur Stundenmitte."""
        elevation, azimuth = solar_position(ts_utc, self.latitude, self.longitude)

        # Sonnenrichtungs-Vektor (Azimut 0=Nord, cw) und Modul-Normalenvektor
        el_r, az_r = math.radians(elevation), math.radians(azimuth)
        sun = [math.sin(az_r) * math.cos(el_r),
               math.cos(az_r) * math.cos(el_r),
               math.sin(el_r)]
        zen_tilt = math.radians(90.0 - self.tilt)
        az_p = math.radians(self.azimuth)
        normal = [math.sin(az_p) * math.cos(zen_tilt),
                  math.cos(az_p) * math.cos(zen_tilt),
                  math.sin(zen_tilt)]

        efficiency = 0.0
        if dni > 0:
            dot = sum(sun[j] * normal[j] for j in range(3))
            efficiency = max(0.0, dot)
        shade = self._shade_factor(elevation, local_hhmm)

        # Verschattung (Baum): Direktstrahlung voll betroffen (shade_percent),
        # Diffusstrahlung kommt anteilig durch (shade_diffuse_pct).
        diffuse_eff = self.diffuse_eff
        if shade < 1.0:
            # Übertrag-Anteil: bei shade=0 (voll blockt) bleibt shade_diffuse_frac übrig
            diffuse_eff *= 1.0 - (1.0 - shade) * (1.0 - self.shade_diffuse_frac)
            # 1 - (1-shade)*(1-frac): shade=1 -> 1.0 (frei); shade=0 -> frac
        direct = dni * efficiency * shade

        reflected = ghi * (0.5 - 0.5 * math.cos(math.radians(self.tilt))) * self.albedo
        total = direct + dif * diffuse_eff + reflected

        t_cell = ambient_temp + 0.0342 * total
        derate = 1.0 + (t_cell - 25.0) * self.temp_coeff

        if self.eff != 0 and self.area != 0:
            dc = total * derate * self.eff * self.area
        else:  # kWp ist bei 1000 W/m² definiert
            dc = total / 1000.0 * derate * self.kwp * 1000.0

        ac = dc * self.inv_eff
        if self.inv_limit > 0:
            ac = min(ac, self.inv_limit)
        # Schatten bereits auf Direkt/Diffus angewendet -> hier nur Feintune
        ac *= self.fine_tune
        return max(0.0, ac)


# ----------------------------------------------------------------------------
# Stunden-Loop (wie im solXcept-Port): bewertet zur Stundenmitte (:30),
# Wetterdaten der Folge-Stunde (Open-Meteo-Angabe "gilt für vorherige Stunde")
# ----------------------------------------------------------------------------
def hourly_watts(plant, times_utc_iso, dni, dif, ghi, temp, local_tz_name):
    """Liefert Liste (iso_lokal_hhmm, watt) je Stunde."""
    import datetime as _dt
    try:
        from zoneinfo import ZoneInfo
        ltz = ZoneInfo(local_tz_name)
    except Exception:
        ltz = _dt.timezone.utc

    out = []
    for i, t_iso in enumerate(times_utc_iso):
        # Stunde endet bei t_iso (Open-Meteo-Konvention) -> Energie der VORherigen
        try:
            hour_end = _dt.datetime.strptime(t_iso, '%Y-%m-%dT%H:%M').replace(tzinfo=_dt.timezone.utc)
        except ValueError:
            continue
        mid = hour_end - _dt.timedelta(minutes=30)
        ts = int(mid.timestamp())
        local = hour_end.astimezone(ltz)
        w = plant.get_power(
            dni[i] or 0, dif[i] or 0, ghi[i] or 0, temp[i] or 0, ts,
            local.strftime('%H:%M'))
        out.append((local.strftime('%Y-%m-%dT%H:%M'), round(w, 1)))
    return out
