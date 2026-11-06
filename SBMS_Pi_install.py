import os
import socket

# ==============================================================================
# SBMS0 Raspberry-Pi Installer (InfluxDB + Serial-Logger, OHNE Grafana)
# Batterie: 280 Ah / 24 V (8s LiFePO4)
#
# Visualisierung läuft über SBMS-LiveWeb (Port 8090) - siehe install_liveweb.py.
# Falls Grafana von einem früheren Stand installiert ist, wird es entfernt.
#
# Voraussetzung: Raspberry Pi OS (Bookworm oder neuer), Root-Rechte (sudo)
# Aufruf:        sudo python3 SBMS_Pi_install.py
# ==============================================================================

# --- InfluxDB-Repository (InfluxData Signing-Key via keyring, apt-key ist deprecated) ---
os.system("sudo mkdir -p /etc/apt/keyrings")
os.system("curl -fsSL https://repos.influxdata.com/influxdata-archive.key | "
          "sudo gpg --dearmor -o /etc/apt/keyrings/influxdata.gpg")
os.system("echo 'deb [signed-by=/etc/apt/keyrings/influxdata.gpg] "
          "https://repos.influxdata.com/debian bookworm stable' | "
          "sudo tee /etc/apt/sources.list.d/influxdb.list")

os.system("sudo apt update")

# --- InfluxDB installieren & starten ---
os.system("sudo apt install -y influxdb")
os.system("sudo systemctl unmask influxdb")
os.system("sudo systemctl enable --now influxdb")

# --- Datenbank anlegen (Retention 1 Jahr + 1-Min-Downsampling) ---
os.system("influx -execute 'CREATE DATABASE SBMS WITH DURATION 365d REPLICATION 1'")
os.system("influx -execute 'CREATE RETENTION POLICY \"raw_1s\" ON \"SBMS\" DURATION 365d REPLICATION 1 DEFAULT'")
os.system("influx -execute 'CREATE RETENTION POLICY \"downsampled_1m\" ON \"SBMS\" DURATION 365d REPLICATION 1'")
os.system("influx -execute 'CREATE CONTINUOUS QUERY \"cq_1m\" ON \"SBMS\" BEGIN "
          "SELECT mean(*) INTO \"downsampled_1m\".\"SBMS_Metrics\" FROM \"SBMS_Metrics\" "
          "GROUP BY time(1m), * END'")

# --- Python-Abhängigkeiten für den Logger ---
os.system("sudo apt install -y python3-pip python3-serial python3-influxdb")
os.system("sudo pip3 install pyserial influxdb --break-system-packages")

# --- Grafana-Entfernung (falls von früheren Läufen vorhanden) ---
os.system("if dpkg -s grafana >/dev/null 2>&1; then "
          "sudo systemctl stop grafana-server 2>/dev/null; "
          "sudo systemctl disable grafana-server 2>/dev/null; "
          "sudo apt purge -y grafana; "
          "sudo rm -rf /etc/grafana /var/lib/grafana /var/log/grafana "
          "/etc/systemd/system/grafana-server.service.d; "
          "sudo rm -f /etc/apt/sources.list.d/grafana.list "
          "/etc/apt/keyrings/grafana.gpg; fi")

# --- Logger-Skript + systemd-Unit laden ---
os.system("sudo wget --no-check-certificate --content-disposition "
          "'https://raw.githubusercontent.com/LeoAlioth/SBMS0/master/sbms0-SerialToInfluxDB.py' -P '/home/SBMS0/'")
os.system("sudo wget --no-check-certificate --content-disposition "
          "'https://raw.githubusercontent.com/LeoAlioth/SBMS0/master/SBMS-Logger.service' -P '/etc/systemd/system/'")
os.system("sudo systemctl daemon-reload")
os.system("sudo systemctl enable SBMS-Logger.service")
os.system("sudo systemctl start SBMS-Logger.service")

print("InfluxDB  : http://localhost:8086")
print("Visualisierung: SBMS-LiveWeb installieren -  sudo python3 install_liveweb.py")
print("(Kein Grafana mehr noetig - Live-Web uebernimmt die Dashboards, Port 8090)")
